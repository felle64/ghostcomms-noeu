// Minimal Fastify WS relay (metadata-minimal).
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
dotenv.config()

const app = Fastify({ logger: false })

await app.register(cors, {
  origin: (origin, cb) => {
    const ok =
      !origin ||
      /localhost:5173$/.test(origin) ||
      /\.githubpreview\.dev$/.test(origin) // Codespaces
    cb(null, ok)
  },
  credentials: true,
})

await app.register(websocket)
await app.register(jwt, { secret: process.env.JWT_SECRET! })

const prisma = new PrismaClient()
type JwtSub = { did: string }

// One connection per deviceId
const conns = new Map<string, import('ws').WebSocket>()

app.get('/health', async () => ({ ok: true, region: process.env.REGION || 'CH' }))

// ---- Registration ----
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

// ---- Prekeys ----
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

// ---- WebSocket relay (token via ?token= OR Authorization: Bearer) ----
app.get('/ws', { websocket: true }, (conn: any, req) => {
  console.log('New WebSocket connection attempt')
  
  // Grab query robustly (some envs don't populate fastify req.query here)
  const rawUrl = (req as any).raw?.url || (req as any).url || ''
  const url = new URL(rawUrl, 'http://local')
  const tokenFromQuery = url.searchParams.get('token') || undefined
  const auth = req.headers['authorization']
  const tokenFromAuth = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
  const token = tokenFromQuery || tokenFromAuth

  if (!token) {
    console.warn('WS: missing token (?token or Authorization)')
    return conn.socket.close()
  }

  let sub: JwtSub
  try { 
    sub = app.jwt.verify(token) as JwtSub 
  } catch (e) { 
    console.warn('WS: bad JWT', e) 
    return conn.socket.close() 
  }

  const did = sub.did
  const ws = conn.socket

  console.log('WebSocket authenticated for device:', did)
  
  // Ensure single live connection
  const existing = conns.get(did)
  if (existing && existing !== conn.socket) {
    console.log('Closing existing connection for', did)
    try { existing.close(1000, 'replaced') } catch {}
    conns.delete(did)
  }
  
  conns.set(did, conn.socket)
  console.log('WS: connected', did, 'total', conns.size)

  // Handle incoming messages
  ws.on('message', async (raw: any) => {
    try {
      console.log('Received message from', did)
      const msg = JSON.parse(String(raw))
      if (!msg?.to || !msg?.ciphertext) {
        console.warn('Invalid message format from', did)
        return
      }

      const expires = new Date(
        Date.now() + Number(process.env.EPHEMERAL_TTL_SECONDS ?? '86400') * 1000
      )

      const env = await prisma.envelope.create({
        data: {
          toDeviceId: msg.to,
          ciphertext: Buffer.from(msg.ciphertext, 'base64'),
          contentType: msg.contentType ?? 'msg',
          expiresAt: expires,
        }
      })

      console.log('Created envelope', env.id, 'from', did, 'to', msg.to)

      const rcv = conns.get(msg.to)
      if (rcv) {
        console.log('Delivering message to', msg.to)
        rcv.send(JSON.stringify({
          id: env.id,
          from: did,
          to: msg.to,
          ciphertext: msg.ciphertext,
          contentType: env.contentType
        }))
        await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
        await prisma.envelope.delete({ where: { id: env.id } })
      } else {
        console.log('Recipient', msg.to, 'not online, message stored')
      }
    } catch (e) {
      console.warn('WS: message handling error for', did, e)
    }
  })

  // Handle connection close - SINGLE HANDLER ONLY
  ws.on('close', (code: number, reason: Buffer) => {
    if (conns.get(did) === ws) {
      conns.delete(did)
    }
    console.log('WS: closed', did, 'code:', code, 'reason:', reason?.toString?.() || '', 'total:', conns.size)
  })

  // Handle connection errors
  ws.on('error', (err) => {
    console.error('WS: error for device', did, ':', (err as any)?.message || err)
  })
})

// ---- Periodic cleanup: remove closed sockets; ping open ones ----
setInterval(() => {
  console.log('Periodic cleanup - checking', conns.size, 'connections')
  for (const [did, sock] of conns) {
    const ws: any = sock
    if (!ws) { 
      conns.delete(did)
      console.log('Removed null socket for', did)
      continue 
    }
    
    // OPEN is 1 in ws; guard if undefined
    const OPEN = ws.OPEN ?? 1
    if (ws.readyState !== OPEN) {
      try { ws.terminate?.() } catch {}
      conns.delete(did)
      console.log('WS: removed dead connection for', did)
      continue
    }
    
    // Send ping to keep connection alive
    try { 
      ws.ping?.()
      console.log('Sent ping to', did) 
    } catch (e) {
      console.warn('Failed to ping', did, e)
    }
  }
}, 30_000)

// ---- Media placeholders ----
app.post('/media/upload', async (_req, reply) => {
  return reply.status(501).send({ error: 'Not Implemented. Wire to Swiss object storage and return signed PUT URL.' })
})

app.get('/media/:key', async (_req, reply) => {
  return reply.status(501).send({ error: 'Not Implemented. Wire to Swiss object storage and return signed GET URL.' })
})

const port = Number(process.env.PORT || 8080)
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`GhostComms • NoEU relay on :${port}`)
})