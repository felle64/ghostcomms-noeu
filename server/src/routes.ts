import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { REGION } from './env'

type JwtSub = { did: string }

export async function registerHttpRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/health', async () => ({ ok: true, region: REGION }))

  app.post('/register', async (req, reply) => {
    const b = await req.body as any
    if (!b?.identityKeyPubB64 || !b?.signedPrekeyPubB64) {
      return reply.status(400).send({ error: 'missing key material' })
    }
    const user = await prisma.user.create({ data: {} })
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        identityKeyPub: Buffer.from(b.identityKeyPubB64, 'base64'),
        signedPrekeyPub: Buffer.from(b.signedPrekeyPubB64, 'base64'),
      }
    })
    if (Array.isArray(b.oneTimePrekeysB64)) {
      await prisma.oneTimePrekey.createMany({
        data: b.oneTimePrekeysB64.map((x: string) => ({
          deviceId: device.id, keyPub: Buffer.from(x, 'base64')
        }))
      })
    }
    const token = await reply.jwtSign({ did: device.id } as JwtSub, { expiresIn: '30d' })
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
