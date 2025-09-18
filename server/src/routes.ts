import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { REGION } from './env'

type JwtSub = { did: string }

type RegisterBody = {
  identityKeyPubB64: string
  signedPrekeyPubB64: string
  oneTimePrekeysB64?: string[]
}

// Robust base64 helper for Prisma Bytes (Buffer | Uint8Array)
const b64 = (bytes?: Uint8Array | Buffer | null) =>
  bytes ? Buffer.from(bytes).toString('base64') : null

export async function registerHttpRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/health', async () => ({ ok: true, region: REGION }))

  // -- Register a device -------------------------------------------------------
  app.post('/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    const b = req.body

    const decode = (s: unknown) => {
      try { return Buffer.from(String(s || ''), 'base64') }
      catch { return Buffer.alloc(0) }
    }

    const idPub = decode(b?.identityKeyPubB64)
    const spPub = decode(b?.signedPrekeyPubB64)

    if (idPub.length !== 32 || spPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid key length; expected 32-byte X25519 public keys' })
    }

    const user = await prisma.user.create({ data: {} })
    const device = await prisma.device.create({
      data: { userId: user.id, identityKeyPub: idPub, signedPrekeyPub: spPub }
    })

    if (Array.isArray(b.oneTimePrekeysB64)) {
      const rows = b.oneTimePrekeysB64
        .map(decode)
        .filter((buf) => buf.length === 32)
        .map((buf) => ({ deviceId: device.id, keyPub: buf }))
      if (rows.length) await prisma.oneTimePrekey.createMany({ data: rows })
    }

    const token = await (reply as any).jwtSign({ did: device.id } as JwtSub, { expiresIn: '30d' })
    return reply.send({ userId: user.id, deviceId: device.id, jwt: token })
  })

  // -- Fetch a recipient's prekey bundle --------------------------------------
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

  // -- Inbox drain for a specific peer (JWT required) -------------------------
  app.get('/inbox/from/:peerId', async (req, reply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const did = (req as any).user?.did as string
    const peerId = (req.params as any).peerId as string
    if (!did || !peerId) return reply.status(400).send({ error: 'bad request' })

    const list = await prisma.envelope.findMany({
      where: { toDeviceId: did, fromDeviceId: peerId },
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

  // -- Media stubs -------------------------------------------------------------
  app.post('/media/upload', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
  app.get('/media/:key', async (_req, reply) => {
    return reply.status(501).send({ error: 'Not Implemented' })
  })
}
