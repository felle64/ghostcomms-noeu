// Minimal Fastify WS relay (metadata-minimal).
// NOTE: Content is opaque ciphertext. Server never sees plaintext.
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
dotenv.config()

const app = Fastify({ logger: false })
await app.register(cors, { origin: false })
await app.register(websocket)
await app.register(jwt, { secret: process.env.JWT_SECRET! })

const prisma = new PrismaClient()

type JwtSub = { did: string }

// In-memory connection registry (MVP). Replace with Redis in prod.
const conns = new Map<string, import('ws').WebSocket>()

app.get('/health', async () => ({ ok: true, region: process.env.REGION || 'CH' }))

// -- Registration (device + public bundle) --
app.post('/register', async (req, reply) => {
  const body = await req.body as any
  // Expect: { identityKeyPubB64, signedPrekeyPubB64, oneTimePrekeysB64: string[], inviteCode?:string }
  if (!body?.identityKeyPubB64 || !body?.signedPrekeyPubB64) {
    return reply.status(400).send({ error: 'missing key material' })
  }
  // Create user lazily per device for MVP
  const user = await prisma.user.create({ data: {} })
  const device = await prisma.device.create({
    data: {
      userId: user.id,
      identityKeyPub: Buffer.from(body.identityKeyPubB64, 'base64'),
      signedPrekeyPub: Buffer.from(body.signedPrekeyPubB64, 'base64'),
    }
  })
  if (Array.isArray(body.oneTimePrekeysB64)) {
    await prisma.oneTimePrekey.createMany({
      data: body.oneTimePrekeysB64.map((b64: string) => ({
        deviceId: device.id, keyPub: Buffer.from(b64, 'base64')
      }))
    })
  }
  const token = await reply.jwtSign({ did: device.id } as JwtSub, { expiresIn: '30d' })
  return reply.send({ userId: user.id, deviceId: device.id, jwt: token })
})

// -- Fetch a recipient's prekey bundle (MVP: by deviceId) --
app.get('/prekeys/:deviceId', async (req, reply) => {
  const deviceId = (req.params as any).deviceId as string
  const device = await prisma.device.findUnique({ where: { id: deviceId }, include: { oneTimePrekeys: { where: { used: false }, take: 1 } } })
  if (!device) return reply.status(404).send({ error: 'not found' })
  const otk = device.oneTimePrekeys[0]
  if (otk) {
    await prisma.oneTimePrekey.update({ where: { id: otk.id }, data: { used: true } })
  }
  return reply.send({
    identityKeyPubB64: device.identityKeyPub.toString('base64'),
    signedPrekeyPubB64: device.signedPrekeyPub.toString('base64'),
    oneTimePrekeyPubB64: otk ? otk.keyPub.toString('base64') : null,
  })
})

// -- WebSocket relay --
app.get('/ws', { websocket: true }, (conn: any, req) => {
  const proto = req.headers['sec-websocket-protocol']
  if (!proto) return conn.socket.close()
  let sub: JwtSub
  try { sub = app.jwt.verify(String(proto)) as JwtSub } catch { return conn.socket.close() }
  const did = sub.did
  conns.set(did, conn.socket)

  conn.socket.on('message', async (raw: any) => {
    try {
      const msg = JSON.parse(String(raw))
      // { to: deviceId, ciphertext: base64, contentType?: 'msg'|'media' }
      if (!msg?.to || !msg?.ciphertext) return
      const expires = new Date(Date.now() + (Number(process.env.EPHEMERAL_TTL_SECONDS || '86400') * 1000))
      const env = await prisma.envelope.create({
        data: {
          toDeviceId: msg.to,
          ciphertext: Buffer.from(msg.ciphertext, 'base64'),
          contentType: msg.contentType ?? 'msg',
          expiresAt: expires,
        }
      })
      const rcv = conns.get(msg.to)
      if (rcv) {
        rcv.send(JSON.stringify({ id: env.id, from: did, to: msg.to, ciphertext: msg.ciphertext, contentType: env.contentType }))
        await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
        // delete immediately after delivery for ephemeral behavior
        await prisma.envelope.delete({ where: { id: env.id } })  // server holds no content post-delivery
      }
    } catch {}
  })

  conn.socket.on('close', () => { conns.delete(did) })
})

// -- Media placeholders (signed URLs to be implemented with your CH object storage) --
app.post('/media/upload', async (req, reply) => {
  return reply.status(501).send({ error: 'Not Implemented. Wire to Swiss object storage and return signed PUT URL.' })
})

app.get('/media/:key', async (req, reply) => {
  return reply.status(501).send({ error: 'Not Implemented. Wire to Swiss object storage and return signed GET URL.' })
})

const port = Number(process.env.PORT || 8080)
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`GhostComms • NoEU relay on :${port}`)
})
