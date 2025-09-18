import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import WebSocket, { WebSocketServer } from 'ws'

type JwtSub = { did: string }

// Bytes→base64 helper (Buffer | Uint8Array)
const b64 = (bytes?: Uint8Array | Buffer | null) =>
  bytes ? Buffer.from(bytes).toString('base64') : null

function verifyToken(app: FastifyInstance, req: import('http').IncomingMessage): JwtSub | null {
  try {
    const url = new URL(req.url || '', 'http://local')
    const token =
      url.searchParams.get('token') ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined)
    if (!token) return null
    return (app as any).jwt.verify(token) as JwtSub
  } catch {
    return null
  }
}

export function attachWs(app: FastifyInstance, prisma: PrismaClient) {
  const wss = new WebSocketServer({ server: (app.server as any) })
  const conns = new Map<string, WebSocket>()

  wss.on('connection', (ws, req) => {
    const sub = verifyToken(app, req)
    if (!sub) { try { ws.close(1008, 'unauthorized') } catch {} ; return }
    const did = sub.did

    conns.set(did, ws)
    console.log('WS: connected', did, 'total', conns.size)

    // send backlog
    ;(async () => {
      const pending = await prisma.envelope.findMany({
        where: { toDeviceId: did }, orderBy: { createdAt: 'asc' }, take: 100
      })
      for (const env of pending) {
        if (ws.readyState !== WebSocket.OPEN) break
        ws.send(JSON.stringify({
          id: env.id,
          from: '(offline)',
          to: did,
          ciphertext: b64(env.ciphertext),  // <-- safe for Uint8Array
          contentType: env.contentType
        }))
        await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
        await prisma.envelope.delete({ where: { id: env.id } })
      }
    })().catch(() => {})

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (!msg?.to || !msg?.ciphertext) return

        const expires = new Date(Date.now() + Number(process.env.EPHEMERAL_TTL_SECONDS ?? '86400') * 1000)
        const env = await prisma.envelope.create({
          data: {
            fromDeviceId: did,
            toDeviceId: msg.to,
            ciphertext: Buffer.from(msg.ciphertext, 'base64'),
            contentType: msg.contentType ?? 'msg',
            expiresAt: expires,
          }
        })

        const rcv = conns.get(msg.to)
        if (rcv && rcv.readyState === WebSocket.OPEN) {
          rcv.send(JSON.stringify({
            id: env.id,
            from: did,
            to: msg.to,
            ciphertext: msg.ciphertext,
            contentType: env.contentType
          }))
          await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
          await prisma.envelope.delete({ where: { id: env.id } })
        }

        // ACK to sender
        const sender = conns.get(did)
        if (sender && sender.readyState === WebSocket.OPEN) {
          sender.send(JSON.stringify({
            type: 'delivered',
            id: env.id,
            to: msg.to,
            mode: rcv && rcv.readyState === WebSocket.OPEN ? 'direct' : 'queued',
            at: new Date().toISOString(),
            clientMsgId: msg.clientMsgId ?? null
          }))
        }
      } catch (e) {
        console.warn('WS: message handling error', (e as Error).message)
      }
    })

    ws.on('close', (code, reason) => {
      if (conns.get(did) === ws) conns.delete(did)
      console.log('WS: closed', did, code, reason?.toString() || '', 'total', conns.size)
    })
  })

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
}
