import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { REGION } from './env'
import { hashPassword, generateSalt, verifyPassword } from './crypto'

type JwtSub = { 
  uid: string  // user id
  did: string  // device id
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

type ContactInfo = {
  username: string
  devices: Array<{
    deviceId: string
    deviceName?: string
    identityKeyPubB64: string
  }>
}

const b64 = (bytes?: Uint8Array | Buffer | null) =>
  bytes ? Buffer.from(bytes).toString('base64') : null

export async function registerHttpRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/health', async () => ({ ok: true, region: REGION }))

  // GET /resolve/:who  -> { deviceId }
app.get('/resolve/:who', async (req, reply) => {
  const who = (req.params as any).who as string
  // if it's already a deviceId, accept it
  const asDevice = await prisma.device.findUnique({ where: { id: who } })
  if (asDevice) return reply.send({ deviceId: asDevice.id })

  // otherwise treat as username (lowercased)
  const user = await prisma.user.findUnique({
    where: { username: who.toLowerCase() },
    include: {
      devices: {
        orderBy: { lastSeenAt: 'desc' }, // or createdAt desc
        take: 1,
      }
    }
  })
  if (!user || user.devices.length === 0) {
    return reply.status(404).send({ error: 'no active device' })
  }
  return reply.send({ deviceId: user.devices[0].id })
})


  // -- Signup (create new user account) ---------------------------------------
  app.post('/signup', async (req: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
    const b = req.body

    // Validate input
    if (!b?.username || !b?.password) {
      return reply.status(400).send({ error: 'username and password required' })
    }

    if (b.username.length < 3 || b.username.length > 30) {
      return reply.status(400).send({ error: 'username must be 3-30 characters' })
    }

    if (!/^[a-zA-Z0-9_]+$/.test(b.username)) {
      return reply.status(400).send({ error: 'username must be alphanumeric' })
    }

    if (b.password.length < 8) {
      return reply.status(400).send({ error: 'password must be at least 8 characters' })
    }

    const decode = (s: unknown) => {
      try { return Buffer.from(String(s || ''), 'base64') }
      catch { return Buffer.alloc(0) }
    }

    const idPub = decode(b.identityKeyPubB64)
    const spPub = decode(b.signedPrekeyPubB64)

    if (idPub.length !== 32 || spPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid key length; expected 32-byte X25519 public keys' })
    }

    // Check if username exists
    const existing = await prisma.user.findUnique({ where: { username: b.username } })
    if (existing) {
      return reply.status(409).send({ error: 'username already taken' })
    }

    // Create user and first device
    const salt = generateSalt()
    const passwordHash = hashPassword(b.password, salt)

    const user = await prisma.user.create({ 
      data: { 
        username: b.username,
        passwordHash,
        salt
      } 
    })

    const device = await prisma.device.create({
      data: { 
        userId: user.id, 
        deviceName: b.deviceName || 'Device 1',
        identityKeyPub: idPub, 
        signedPrekeyPub: spPub 
      }
    })

    // Add one-time prekeys if provided
    if (Array.isArray(b.oneTimePrekeysB64)) {
      const rows = b.oneTimePrekeysB64
        .map(decode)
        .filter((buf) => buf.length === 32)
        .map((buf) => ({ deviceId: device.id, keyPub: buf }))
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

  // -- Login (add device to existing account) ---------------------------------
  app.post('/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const b = req.body

    // Validate input
    if (!b?.username || !b?.password) {
      return reply.status(400).send({ error: 'username and password required' })
    }

    const decode = (s: unknown) => {
      try { return Buffer.from(String(s || ''), 'base64') }
      catch { return Buffer.alloc(0) }
    }

    const idPub = decode(b.identityKeyPubB64)
    const spPub = decode(b.signedPrekeyPubB64)

    if (idPub.length !== 32 || spPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid key length; expected 32-byte X25519 public keys' })
    }

    // Find user
    const user = await prisma.user.findUnique({ 
      where: { username: b.username },
      include: { devices: true }
    })

    if (!user) {
      return reply.status(401).send({ error: 'invalid credentials' })
    }

    // Verify password
    if (!verifyPassword(b.password, user.salt, user.passwordHash)) {
      return reply.status(401).send({ error: 'invalid credentials' })
    }

    // Check for duplicate device keys (prevent key reuse)
    const existingDevice = await prisma.device.findFirst({
      where: {
        userId: user.id,
        identityKeyPub: idPub
      }
    })

    if (existingDevice) {
      // Update last seen and return existing device
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

    // Create new device for this user
    const deviceCount = user.devices.length
    const device = await prisma.device.create({
      data: { 
        userId: user.id, 
        deviceName: b.deviceName || `Device ${deviceCount + 1}`,
        identityKeyPub: idPub, 
        signedPrekeyPub: spPub 
      }
    })

    // Add one-time prekeys if provided
    if (Array.isArray(b.oneTimePrekeysB64)) {
      const rows = b.oneTimePrekeysB64
        .map(decode)
        .filter((buf) => buf.length === 32)
        .map((buf) => ({ deviceId: device.id, keyPub: buf }))
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

  // -- Get user info (for adding contacts) ------------------------------------
// Get user info with all devices for encryption
app.get('/user/:username', async (req, reply) => {
  const username = (req.params as any).username as string
  
  const user = await prisma.user.findUnique({
    where: { username },
    include: { 
      devices: {
        select: {
          id: true,
          deviceName: true,
          identityKeyPub: true,
          lastSeenAt: true
        },
        orderBy: {
          lastSeenAt: 'desc'  // Most recently active first
        }
      }
    }
  })

  if (!user) {
    return reply.status(404).send({ error: 'user not found' })
  }

  return reply.send({
    username: user.username,
    devices: user.devices.map(d => ({
      deviceId: d.id,
      deviceName: d.deviceName || undefined,
      identityKeyPubB64: b64(d.identityKeyPub)!,
      lastSeenAt: d.lastSeenAt.toISOString()
    }))
  })
})

  // -- Fetch prekey bundle for specific device --------------------------------
  app.get('/prekeys/:deviceId', async (req, reply) => {
    const deviceId = (req.params as any).deviceId as string
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { oneTimePrekeys: { where: { used: false }, take: 1 } }
    })
    if (!device) return reply.status(404).send({ error: 'not found' })

    const otk = device.oneTimePrekeys[0]
    if (otk) await prisma.oneTimePrekey.update({ where: { id: otk.id }, data: { used: true } })

    return reply.send({
      identityKeyPubB64: b64(device.identityKeyPub),
      signedPrekeyPubB64: b64(device.signedPrekeyPub),
      oneTimePrekeyPubB64: b64(otk?.keyPub),
    })
  })

  // -- Get my devices (JWT required) ------------------------------------------
  app.get('/my-devices', async (req, reply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const uid = (req as any).user?.uid as string
    if (!uid) return reply.status(400).send({ error: 'bad request' })

    const devices = await prisma.device.findMany({
      where: { userId: uid },
      select: {
        id: true,
        deviceName: true,
        lastSeenAt: true,
        createdAt: true
      }
    })

    return reply.send({ devices })
  })

  // -- Remove device (JWT required) -------------------------------------------
  app.delete('/device/:deviceId', async (req, reply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const uid = (req as any).user?.uid as string
    const did = (req as any).user?.did as string
    const targetId = (req.params as any).deviceId as string

    if (!uid || !did) return reply.status(400).send({ error: 'bad request' })

    // Can't remove current device
    if (targetId === did) {
      return reply.status(400).send({ error: 'cannot remove current device' })
    }

    // Verify ownership
    const device = await prisma.device.findFirst({
      where: { id: targetId, userId: uid }
    })

    if (!device) {
      return reply.status(404).send({ error: 'device not found' })
    }

    // Delete device and related data
    await prisma.oneTimePrekey.deleteMany({ where: { deviceId: targetId } })
    await prisma.device.delete({ where: { id: targetId } })

    return reply.send({ success: true })
  })

  // -- Inbox drain for a specific peer (JWT required) -------------------------
  app.get('/inbox/from/:username', async (req, reply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const did = (req as any).user?.did as string
    const username = (req.params as any).username as string
    if (!did || !username) return reply.status(400).send({ error: 'bad request' })

    // Find peer's devices
    const peer = await prisma.user.findUnique({
      where: { username },
      include: { devices: { select: { id: true } } }
    })

    if (!peer) return reply.send({ items: [] })

    const peerDeviceIds = peer.devices.map(d => d.id)

    // Get messages from any of peer's devices
    const list = await prisma.envelope.findMany({
      where: { 
        toDeviceId: did, 
        fromDeviceId: { in: peerDeviceIds }
      },
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
        ciphertextB64: b64(e.ciphertext),
        contentType: e.contentType,
        createdAt: e.createdAt.toISOString(),
      }))
    })
  })

  // Keep media stubs as before
  app.post('/media/upload', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
  app.get('/media/:key', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
}