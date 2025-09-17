import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { REGION } from './env'

type JwtSub = { did: string }

export async function registerHttpRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/health', async () => ({ ok: true, region: REGION }))

  // inside registerHttpRoutes(app, prisma)
app.post('/register', async (req, reply) => {
  const b = await req.body as any

  // decode helpers
  const decode = (s: unknown) => {
    try { return Buffer.from(String(s || ''), 'base64') } catch { return Buffer.alloc(0) }
  }

  const idPub = decode(b.identityKeyPubB64)
  const spPub = decode(b.signedPrekeyPubB64)

  // ✅ enforce NaCl/X25519 public keys (32 bytes)
  if (idPub.length !== 32 || spPub.length !== 32) {
    return reply.status(400).send({
      error: 'invalid key length; expected 32-byte X25519 public keys'
    })
  }

  const user = await prisma.user.create({ data: {} })
  const device = await prisma.device.create({
    data: {
      userId: user.id,
      identityKeyPub: idPub,
      signedPrekeyPub: spPub,
    }
  })

  if (Array.isArray(b.oneTimePrekeysB64)) {
    // (optional) only accept valid 32-byte prekeys
    const rows = b.oneTimePrekeysB64
      .map(decode)
      .filter((buf: Buffer) => buf.length === 32)
      .map((buf: Buffer) => ({ deviceId: device.id, keyPub: buf }))
    if (rows.length) await prisma.oneTimePrekey.createMany({ data: rows })
  }

  const token = await reply.jwtSign({ did: device.id } as { did: string }, { expiresIn: '30d' })
  return reply.send({ userId: user.id, deviceId: device.id, jwt: token })
})


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
      identityKeyPubB64: device.identityKeyPub.toString('base64'),
      signedPrekeyPubB64: device.signedPrekeyPub.toString('base64'),
      oneTimePrekeyPubB64: otk ? otk.keyPub.toString('base64') : null,
    })
  })

  app.post('/media/upload', async (_req, reply) => reply.status(501).send({ error: 'Not Implemented' }))
  app.get('/media/:key', async (_req, reply) => reply.status(501).send({ error: 'Not Implemented' }))
}
