// src/routes.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { REGION } from './env'
import { hashPassword, generateSalt, verifyPassword } from './crypto'

type JwtSub = {
  uid: string // user id
  did: string // device id
}

type SignupBody = {
  username: string
  password: string
  deviceName?: string
  identityKeyPubB64: string
  signedPrekeyPubB64: string
  oneTimePrekeysB64?: string[]
}

type LoginBody = {
  username: string
  password: string
  deviceName?: string
  identityKeyPubB64: string
  signedPrekeyPubB64: string
  oneTimePrekeysB64?: string[]
}

const toB64 = (bytes?: Uint8Array | Buffer | null) =>
  bytes ? Buffer.from(bytes).toString('base64') : null

const fromB64 = (s: unknown): Buffer => {
  try { return Buffer.from(String(s ?? ''), 'base64') }
  catch { return Buffer.alloc(0) }
}

export async function registerHttpRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // --- health ---
  app.get('/health', async () => ({ ok: true, region: REGION }))

  // --- resolve: username -> latest active deviceId (or accept a deviceId) ---
  app.get('/resolve/:who', async (req, reply) => {
    const who = String((req.params as any).who || '')

    // If it's already a device id, accept it
    const asDevice = await prisma.device.findUnique({ where: { id: who } })
    if (asDevice) return reply.send({ deviceId: asDevice.id })

    const uname = who.trim().toLowerCase()
    const user = await prisma.user.findUnique({
      where: { username: uname },
      include: {
        devices: {
          orderBy: { lastSeenAt: 'desc' },
          take: 1,
        }
      }
    })
    if (!user || user.devices.length === 0) {
      return reply.status(404).send({ error: 'no active device' })
    }
    return reply.send({ deviceId: user.devices[0].id })
  })

  // --- signup: create user + first device ---
  app.post('/signup', async (req: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
    const b = req.body

    if (!b?.username || !b?.password) {
      return reply.status(400).send({ error: 'username and password required' })
    }

    const uname = String(b.username).trim().toLowerCase()
    if (uname.length < 3 || uname.length > 30) {
      return reply.status(400).send({ error: 'username must be 3-30 characters' })
    }
    if (!/^[a-z0-9_]+$/.test(uname)) {
      return reply.status(400).send({ error: 'username must be alphanumeric' })
    }
    if (b.password.length < 8) {
      return reply.status(400).send({ error: 'password must be at least 8 characters' })
    }

    const idPub = fromB64(b.identityKeyPubB64)
    const spPub = fromB64(b.signedPrekeyPubB64)
    if (idPub.length !== 32 || spPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid key length; expected 32-byte X25519 public keys' })
    }

    const existing = await prisma.user.findUnique({ where: { username: uname } })
    if (existing) return reply.status(409).send({ error: 'username already taken' })

    const salt = generateSalt()
    const passwordHash = hashPassword(b.password, salt)

    const user = await prisma.user.create({
      data: { username: uname, passwordHash, salt }
    })

    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: b.deviceName || 'Device 1',
        identityKeyPub: idPub,
        signedPrekeyPub: spPub,
      }
    })

    // optional OTKs
    if (Array.isArray(b.oneTimePrekeysB64) && b.oneTimePrekeysB64.length) {
      const rows = b.oneTimePrekeysB64
        .map((s: string) => fromB64(s))
        .filter((buf: Buffer) => buf.length === 32)
        .map((buf: Buffer) => ({ deviceId: device.id, keyPub: buf }))
      if (rows.length) await prisma.oneTimePrekey.createMany({ data: rows })
    }

    const token = await (reply as any).jwtSign(
      { uid: user.id, did: device.id } as JwtSub,
      { expiresIn: '30d' }
    )

    return reply.status(201).send({
      userId: user.id,
      username: user.username,
      deviceId: device.id,
      deviceName: device.deviceName,
      jwt: token
    })
  })

  // --- login: add a device (or reuse if same keys) ---
  app.post('/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const b = req.body
    if (!b?.username || !b?.password) {
      return reply.status(400).send({ error: 'username and password required' })
    }

    const uname = String(b.username).trim().toLowerCase()
    const idPub = fromB64(b.identityKeyPubB64)
    const spPub = fromB64(b.signedPrekeyPubB64)
    if (idPub.length !== 32 || spPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid key length; expected 32-byte X25519 public keys' })
    }

    const user = await prisma.user.findUnique({
      where: { username: uname },
      include: { devices: true }
    })
    if (!user) return reply.status(401).send({ error: 'invalid credentials' })

    if (!verifyPassword(b.password, user.salt, user.passwordHash)) {
      return reply.status(401).send({ error: 'invalid credentials' })
    }

    // Reuse device if same identity key (prevents dup)
    const existingDevice = await prisma.device.findFirst({
      where: { userId: user.id, identityKeyPub: idPub }
    })

    if (existingDevice) {
      await prisma.device.update({
        where: { id: existingDevice.id },
        data: { lastSeenAt: new Date() }
      })
      const token = await (reply as any).jwtSign(
        { uid: user.id, did: existingDevice.id } as JwtSub,
        { expiresIn: '30d' }
      )
      return reply.send({
        userId: user.id,
        username: user.username,
        deviceId: existingDevice.id,
        deviceName: existingDevice.deviceName,
        jwt: token,
        existingDevice: true
      })
    }

    // Create a new device
    const deviceCount = user.devices.length
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: b.deviceName || `Device ${deviceCount + 1}`,
        identityKeyPub: idPub,
        signedPrekeyPub: spPub
      }
    })

    if (Array.isArray(b.oneTimePrekeysB64) && b.oneTimePrekeysB64.length) {
      const rows = b.oneTimePrekeysB64
        .map((s: string) => fromB64(s))
        .filter((buf: Buffer) => buf.length === 32)
        .map((buf: Buffer) => ({ deviceId: device.id, keyPub: buf }))
      if (rows.length) await prisma.oneTimePrekey.createMany({ data: rows })
    }

    const token = await (reply as any).jwtSign(
      { uid: user.id, did: device.id } as JwtSub,
      { expiresIn: '30d' }
    )

    return reply.send({
      userId: user.id,
      username: user.username,
      deviceId: device.id,
      deviceName: device.deviceName,
      jwt: token
    })
  })

  // --- get user + all devices (for adding contacts) ---
  app.get('/user/:username', async (req, reply) => {
    const username = String((req.params as any).username || '').toLowerCase()

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        devices: {
          select: { id: true, deviceName: true, identityKeyPub: true, lastSeenAt: true },
          orderBy: { lastSeenAt: 'desc' }
        }
      }
    })

    if (!user) return reply.status(404).send({ error: 'user not found' })

    return reply.send({
      username: user.username,
      devices: user.devices.map(d => ({
        deviceId: d.id,
        deviceName: d.deviceName || undefined,
        identityKeyPubB64: toB64(d.identityKeyPub)!,
        lastSeenAt: d.lastSeenAt.toISOString()
      }))
    })
  })

  // --- fetch prekey bundle for a given device ---
  app.get('/prekeys/:deviceId', async (req, reply) => {
    const deviceId = String((req.params as any).deviceId || '')
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { oneTimePrekeys: { where: { used: false }, take: 1 } }
    })
    if (!device) return reply.status(404).send({ error: 'not found' })

    const otk = device.oneTimePrekeys[0]
    if (otk) await prisma.oneTimePrekey.update({ where: { id: otk.id }, data: { used: true } })

    return reply.send({
      identityKeyPubB64: toB64(device.identityKeyPub),
      signedPrekeyPubB64: toB64(device.signedPrekeyPub),
      oneTimePrekeyPubB64: toB64(otk?.keyPub),
    })
  })

  // --- my devices (JWT) ---
  app.get('/my-devices', async (req, reply) => {
    try { await (req as any).jwtVerify() }
    catch { return reply.status(401).send({ error: 'unauthorized' }) }

    const uid = (req as any).user?.uid as string
    if (!uid) return reply.status(400).send({ error: 'bad request' })

    const devices = await prisma.device.findMany({
      where: { userId: uid },
      select: { id: true, deviceName: true, lastSeenAt: true, createdAt: true }
    })
    return reply.send({ devices })
  })

  // --- remove device (JWT) ---
  app.delete('/device/:deviceId', async (req, reply) => {
    try { await (req as any).jwtVerify() }
    catch { return reply.status(401).send({ error: 'unauthorized' }) }

    const uid = (req as any).user?.uid as string
    const did = (req as any).user?.did as string
    const targetId = String((req.params as any).deviceId || '')

    if (!uid || !did) return reply.status(400).send({ error: 'bad request' })
    if (targetId === did) return reply.status(400).send({ error: 'cannot remove current device' })

    const device = await prisma.device.findFirst({ where: { id: targetId, userId: uid } })
    if (!device) return reply.status(404).send({ error: 'device not found' })

    await prisma.oneTimePrekey.deleteMany({ where: { deviceId: targetId } })
    await prisma.device.delete({ where: { id: targetId } })

    return reply.send({ success: true })
  })

  // --- inbox drain from a username's devices (JWT) ---
  app.get('/inbox/from/:username', async (req, reply) => {
    try { await (req as any).jwtVerify() }
    catch { return reply.status(401).send({ error: 'unauthorized' }) }

    const did = (req as any).user?.did as string
    const username = String((req.params as any).username || '').toLowerCase()
    if (!did || !username) return reply.status(400).send({ error: 'bad request' })

    const peer = await prisma.user.findUnique({
      where: { username },
      include: { devices: { select: { id: true } } }
    })
    if (!peer) return reply.send({ items: [] })

    const peerDeviceIds = peer.devices.map(d => d.id)

    const list = await prisma.envelope.findMany({
      where: { toDeviceId: did, fromDeviceId: { in: peerDeviceIds } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    if (list.length === 0) return reply.send({ items: [] })

    const ids = list.map(x => x.id)
    await prisma.envelope.updateMany({ where: { id: { in: ids } }, data: { deliveredAt: new Date() } })
    await prisma.envelope.deleteMany({ where: { id: { in: ids } } })

    return reply.send({
      items: list.map(e => ({
        id: e.id,
        from: e.fromDeviceId,
        ciphertextB64: toB64(e.ciphertext),
        contentType: e.contentType,
        createdAt: e.createdAt.toISOString(),
      }))
    })
  })

  // --- media stubs ---
  app.post('/media/upload', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
  app.get('/media/:key', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
}
