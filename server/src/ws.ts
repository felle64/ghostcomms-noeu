import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import WebSocket, { WebSocketServer } from 'ws'

type JwtSub = { uid: string; did: string }

// Rate limiting for WebSocket messages
type RateLimitEntry = {
  count: number
  resetAt: number
}

const MESSAGE_RATE_LIMIT = 50 // messages per window
const RATE_WINDOW_MS = 60000 // 1 minute
const wsRateLimits = new Map<string, RateLimitEntry>()

function checkRateLimit(deviceId: string): boolean {
  const now = Date.now()
  const entry = wsRateLimits.get(deviceId)

  if (!entry || now > entry.resetAt) {
    wsRateLimits.set(deviceId, {
      count: 1,
      resetAt: now + RATE_WINDOW_MS
    })
    return true
  }

  if (entry.count >= MESSAGE_RATE_LIMIT) {
    return false
  }

  entry.count++
  return true
}

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
  const conns = new Map<string, WebSocket>()  // deviceId -> WebSocket
  const userDevices = new Map<string, Set<string>>() // userId -> Set<deviceId>

  wss.on('connection', (ws, req) => {
    const sub = verifyToken(app, req)
    if (!sub) { 
      try { ws.close(1008, 'unauthorized') } catch {} 
      return 
    }
    const { uid, did } = sub

    // Track connection
    conns.set(did, ws)
    
    // Track user's devices
    if (!userDevices.has(uid)) {
      userDevices.set(uid, new Set())
    }
    userDevices.get(uid)!.add(did)

    console.log('WS: connected', did, 'user', uid, 'total', conns.size)

    // Update last seen
    prisma.device.update({
      where: { id: did },
      data: { lastSeenAt: new Date() }
    }).catch((err) => {
      console.error('Failed to update lastSeenAt for device', did, err)
    })

    // Send backlog for this specific device
    ;(async () => {
      const pending = await prisma.envelope.findMany({
        where: { 
          OR: [
            { toDeviceId: did },
            { toUserId: uid, toDeviceId: null }  // Messages for user without specific device
          ]
        }, 
        orderBy: { createdAt: 'asc' }, 
        take: 100
      })
      
      for (const env of pending) {
        if (ws.readyState !== WebSocket.OPEN) break
        ws.send(JSON.stringify({
          id: env.id,
          from: env.fromDeviceId,
          to: did,
          ciphertext: b64(env.ciphertext),
          contentType: env.contentType
        }))
        await prisma.envelope.update({ where: { id: env.id }, data: { deliveredAt: new Date() } })
        await prisma.envelope.delete({ where: { id: env.id } })
      }
    })().catch((err) => {
      console.error('Failed to send backlog for device', did, err)
    })

    ws.on('message', async (raw) => {
      try {
        // Rate limit check
        if (!checkRateLimit(did)) {
          ws.send(JSON.stringify({
            type: 'error',
            code: 'RATE_LIMIT',
            message: 'Too many messages, please slow down'
          }))
          return
        }

        const msg = JSON.parse(String(raw))
        if (!msg?.to || !msg?.ciphertext) return

        // msg.to can be either a username or a deviceId
        let targetUserId: string | undefined
        let targetDeviceId: string | undefined
        
        // Check if it's a deviceId
        const targetDevice = await prisma.device.findUnique({
          where: { id: msg.to },
          select: { userId: true }
        })

        if (targetDevice) {
          targetUserId = targetDevice.userId
          targetDeviceId = msg.to
        } else {
          // Try to find by username
          const targetUser = await prisma.user.findUnique({
            where: { username: msg.to },
            select: { id: true }
          })
          
          if (targetUser) {
            targetUserId = targetUser.id
            // Don't set targetDeviceId - will be delivered to all user's devices
          } else {
            // Invalid recipient
            return
          }
        }

        const expires = new Date(Date.now() + Number(process.env.EPHEMERAL_TTL_SECONDS ?? '86400') * 1000)
        const env = await prisma.envelope.create({
          data: {
            fromDeviceId: did,
            toUserId: targetUserId!,
            toDeviceId: targetDeviceId || null,
            ciphertext: Buffer.from(msg.ciphertext, 'base64'),
            contentType: msg.contentType ?? 'msg',
            expiresAt: expires,
          }
        })

        // Try to deliver immediately
        let delivered = false
        
        if (targetDeviceId) {
          // Deliver to specific device
          const rcv = conns.get(targetDeviceId)
          if (rcv && rcv.readyState === WebSocket.OPEN) {
            rcv.send(JSON.stringify({
              id: env.id,
              from: did,
              to: targetDeviceId,
              ciphertext: msg.ciphertext,
              contentType: env.contentType
            }))
            delivered = true
          }
        } else if (targetUserId) {
          // Deliver to all user's online devices
          const userDeviceIds = userDevices.get(targetUserId)
          if (userDeviceIds) {
            for (const deviceId of userDeviceIds) {
              const rcv = conns.get(deviceId)
              if (rcv && rcv.readyState === WebSocket.OPEN) {
                rcv.send(JSON.stringify({
                  id: env.id,
                  from: did,
                  to: deviceId,
                  ciphertext: msg.ciphertext,
                  contentType: env.contentType
                }))
                delivered = true
              }
            }
          }
        }

        if (delivered) {
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
            mode: delivered ? 'direct' : 'queued',
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
      
      // Remove from user's device set
      const devices = userDevices.get(uid)
      if (devices) {
        devices.delete(did)
        if (devices.size === 0) {
          userDevices.delete(uid)
        }
      }
      
      console.log('WS: closed', did, code, reason?.toString() || '', 'total', conns.size)
    })
  })

  // Keepalive ping
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

  // Cleanup old rate limit entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [deviceId, entry] of wsRateLimits.entries()) {
      if (now > entry.resetAt) {
        wsRateLimits.delete(deviceId)
      }
    }
  }, 60000)
}