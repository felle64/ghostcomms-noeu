// GhostComms • NoEU — Fastify HTTP + ws WebSocket relay (stable order)
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'
import { WebSocketServer, WebSocket } from 'ws'
import dotenv from 'dotenv'
dotenv.config()

const app = Fastify({ logger: false })
await app.register(cors, {
  origin: (origin, cb) => {
    const ok = !origin || /localhost:5173$/.test(origin) || /\.githubpreview\.dev$/.test(origin)
    cb(null, ok)
  },
  credentials: true,
})
await app.register(jwt, { secret: process.env.JWT_SECRET! })

const prisma = new PrismaClient()
type JwtSub = { did: string }

// ---------- HTTP routes (define BEFORE listen) ----------
app.get('/health', async () => ({ ok: true, region: process.env.REGION || 'CH' }))

app.post('/register', async (req, reply) => {
  const body = await req.body as any
  if (!body?.identityKeyPubB64 || !body?.signedPrekeyPubB64) {
    return reply.status(400).send({ error: 'missing key material' })
  }
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

// (optional stubs)
app.post('/media/upload', async (_req, reply) => reply.status(501).send({ error: 'Not Implemented' }))
app.get('/media/:key', async (_req, reply) => reply.status(501).send({ error: 'Not Implemented' }))

// ---------- Start Fastify HTTP server ----------
const port = Number(process.env.PORT || 8080)
await app.listen({ port, host: '0.0.0.0' })
console.log(`GhostComms • NoEU relay on :${port}`)

// ---------- Attach plain ws WebSocket server AFTER listen ----------
const wss = new WebSocketServer({ server: app.server as any })

// One mapping per deviceId (we do NOT force-close older sockets)
const conns = new Map<string, WebSocket>()

function verifyToken(req: import('http').IncomingMessage): JwtSub | null {
  try {
    const url = new URL(req.url || '', 'http://local')
    const token =
      url.searchParams.get('token') ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined)
    if (!token) return null
    return app.jwt.verify(token) as JwtSub
  } catch { return null }
}

wss.on('connection', (ws, req) => {
  const sub = verifyToken(req)
  if (!sub) { try { ws.close(1008, 'unauthorized') } catch {} ; return }
  const did = sub.did

  conns.set(did, ws)
  console.log('WS: connected', did, 'total', conns.size)
  // after: conns.set(did, ws) and the "WS: connected" log
;(async () => {
  try {
    const pending = await prisma.envelope.findMany({
      where: { toDeviceId: did },
      orderBy: { createdAt: 'asc' },
      take: 100
    })
    for (const env of pending) {
      if (ws.readyState !== WebSocket.OPEN) break
      ws.send(JSON.stringify({
        id: env.id,
        from: '(offline)',
        to: did,
        ciphertext: env.ciphertext.toString('base64'),
        contentType: env.contentType
      }))
      await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
      await prisma.envelope.delete({ where: { id: env.id } })
    }
  } catch (e) {
    console.warn('WS: backlog error', (e as Error).message)
  }
})()


  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (!msg?.to || !msg?.ciphertext) return

      const expires = new Date(Date.now() + Number(process.env.EPHEMERAL_TTL_SECONDS ?? '86400') * 1000)
      const env = await prisma.envelope.create({
        data: {
          toDeviceId: msg.to,
          ciphertext: Buffer.from(msg.ciphertext, 'base64'),
          contentType: msg.contentType ?? 'msg',
          expiresAt: expires,
        }
      })

      const rcv = conns.get(msg.to)
      if (rcv && rcv.readyState === WebSocket.OPEN) {
        rcv.send(JSON.stringify({
          id: env.id, from: did, to: msg.to, ciphertext: msg.ciphertext, contentType: env.contentType
        }))
        await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
        await prisma.envelope.delete({ where: { id: env.id } })
      }
    } catch (e) {
      console.warn('WS: message handling error', (e as Error).message)
    }
  })

  ws.on('close', (code, reason) => {
    if (conns.get(did) === ws) conns.delete(did)
    console.log('WS: closed', did, code, reason?.toString() || '', 'total', conns.size)
  })

  ws.on('error', (e) => console.warn('WS: error', did, (e as any)?.message || e))
})

// Safe cleanup (no custom flags)
setInterval(() => {
  for (const [did, ws] of conns) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      try { ws?.terminate() } catch {}
      conns.delete(did)
      console.log('WS: removed dead', did)
      continue
    }
    try { ws.ping() } catch {}
  }
}, 30_000)
