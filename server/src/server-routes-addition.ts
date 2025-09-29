
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { generateSalt } from './crypto'

// Add these routes to your server/src/routes.ts file

// Import additional types needed
type LinkingStartBody = {
  provisioningAddress: string
  linkingKeyPubB64: string
}

type LinkingPairBody = {
  provisioningAddress: string
  devicePublicKeyB64: string
  deviceName?: string
}

type ProvisionBody = {
  sessionId: string
  targetDeviceId: string
  provisioningMessage: {
    identityKeyPubB64: string
    signedPrekeyPubB64: string
    archiveKey?: string
    accountInfo: {
      userId: string
      username: string
    }
  }
}

const prisma = new PrismaClient()

// Add these routes to your registerHttpRoutes function:

export default async function registerRoutes(app: FastifyInstance) {
  // Start device linking session
  app.post('/linking/start', async (req: FastifyRequest<{ Body: LinkingStartBody }>, reply: FastifyReply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const uid = (req as any).user?.uid as string
    const b = req.body

    if (!b?.provisioningAddress || !b?.linkingKeyPubB64) {
      return reply.status(400).send({ error: 'missing required fields' })
    }

    // Validate base64 key
    const decode = (s: string) => {
      try { return Buffer.from(s, 'base64') }
      catch { return Buffer.alloc(0) }
    }

    const linkingKeyPub = decode(b.linkingKeyPubB64)
    if (linkingKeyPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid linking key length' })
    }

    // Create linking session (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    const session = await prisma.linkingSession.create({
      data: {
        userId: uid,
        provisioningAddress: b.provisioningAddress,
        linkingKeyPub: linkingKeyPub,
        linkingKeyPriv: Buffer.alloc(0), // Not stored on server for security
        qrData: Buffer.from(JSON.stringify({
          provisioningAddress: b.provisioningAddress,
          devicePublicKey: b.linkingKeyPubB64,
          timestamp: Date.now(),
          version: 1
        })).toString('base64'),
        expiresAt
      }
    })

    return reply.send({
      id: session.id,
      qrData: session.qrData,
      expiresAt: session.expiresAt.toISOString()
    })
  })

  // Pair new device with existing account
  app.post('/linking/pair', async (req: FastifyRequest<{ Body: LinkingPairBody }>, reply: FastifyReply) => {
    const b = req.body

    if (!b?.provisioningAddress || !b?.devicePublicKeyB64) {
      return reply.status(400).send({ error: 'missing required fields' })
    }

    // Find active linking session
    const session = await prisma.linkingSession.findFirst({
      where: {
        provisioningAddress: b.provisioningAddress,
        used: false,
        expiresAt: { gt: new Date() }
      },
      include: { user: true }
    })

    if (!session) {
      return reply.status(404).send({ error: 'invalid or expired linking session' })
    }

    // Validate device public key
    const decode = (s: string) => {
      try { return Buffer.from(s, 'base64') }
      catch { return Buffer.alloc(0) }
    }

    const deviceKeyPub = decode(b.devicePublicKeyB64)
    if (deviceKeyPub.length !== 32) {
      return reply.status(400).send({ error: 'invalid device key length' })
    }

    // Create new device for the user
    const deviceCount = await prisma.device.count({ where: { userId: session.userId } })

    const device = await prisma.device.create({
      data: {
        userId: session.userId,
        deviceName: b.deviceName || `Device ${deviceCount + 1}`,
        identityKeyPub: deviceKeyPub,
        signedPrekeyPub: deviceKeyPub, // Temporary - in real implementation, get proper signed prekey
        isPrimary: false
      }
    })

    return reply.send({
      deviceId: device.id,
      userId: session.userId,
      username: session.user.username
    })
  })

  // Send provisioning message to new device
  app.post('/linking/provision', async (req: FastifyRequest<{ Body: ProvisionBody }>, reply: FastifyReply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const uid = (req as any).user?.uid as string
    const b = req.body

    if (!b?.sessionId || !b?.targetDeviceId || !b?.provisioningMessage) {
      return reply.status(400).send({ error: 'missing required fields' })
    }

    // Verify linking session belongs to user
    const session = await prisma.linkingSession.findFirst({
      where: {
        id: b.sessionId,
        userId: uid,
        used: false,
        expiresAt: { gt: new Date() }
      }
    })

    if (!session) {
      return reply.status(404).send({ error: 'invalid linking session' })
    }

    // Store provisioning message temporarily (in real implementation, send via WebSocket)
    // For now, we'll store it in a simple way that can be polled
    await prisma.$executeRaw`
      INSERT INTO provisioning_messages (device_id, message_data, expires_at)
      VALUES (${b.targetDeviceId}, ${JSON.stringify(b.provisioningMessage)}, ${new Date(Date.now() + 5 * 60 * 1000)})
      ON CONFLICT (device_id) DO UPDATE SET
        message_data = EXCLUDED.message_data,
        expires_at = EXCLUDED.expires_at
    `

    // Mark session as used
    await prisma.linkingSession.update({
      where: { id: session.id },
      data: { used: true }
    })

    return reply.send({ success: true })
  })

  // Get provisioning message for device
  app.get('/linking/provision/:deviceId', async (
    req: FastifyRequest<{ Params: { deviceId: string } }>,
    reply: FastifyReply
  ) => {
    const deviceId = req.params.deviceId

    try {
      // Query provisioning message (this would be a proper table in production)
      const result = await prisma.$queryRaw`
        SELECT message_data FROM provisioning_messages
        WHERE device_id = ${deviceId} AND expires_at > NOW()
      `

      if (!result || (result as any[]).length === 0) {
        return reply.status(404).send({ error: 'no provisioning message' })
      }

      const messageData = (result as any[])[0].message_data

      // Delete the message after retrieval (one-time use)
      await prisma.$executeRaw`
        DELETE FROM provisioning_messages WHERE device_id = ${deviceId}
      `

      return reply.send(messageData)
    } catch (error) {
      return reply.status(500).send({ error: 'database error' })
    }
  })

  // Create history archive
  app.post('/history/archive', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await (req as any).jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const uid = (req as any).user?.uid as string

    // Get binary data from request
    const encryptedData = new Uint8Array(await (req as any).raw())

    if (encryptedData.length === 0) {
      return reply.status(400).send({ error: 'no data provided' })
    }

    // Generate unique archive key
    const archiveKey = generateSalt() // Reuse existing salt generation function

    // Store archive (expires in 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const archive = await prisma.historyArchive.create({
      data: {
        userId: uid,
        archiveKey,
        encryptedData: Buffer.from(encryptedData),
        size: encryptedData.length,
        messageCount: 0, // Could be parsed from the data if needed
        expiresAt
      }
    })

    return reply.send({
      archiveKey: archive.archiveKey,
      size: archive.size,
      expiresAt: archive.expiresAt.toISOString()
    })
  })

  // Download history archive
  app.get('/history/download/:archiveKey', async (
    req: FastifyRequest<{ Params: { archiveKey: string } }>,
    reply: FastifyReply
  ) => {
    const archiveKey = req.params.archiveKey

    const archive = await prisma.historyArchive.findFirst({
      where: {
        archiveKey,
        expiresAt: { gt: new Date() },
        downloaded: false
      }
    })

    if (!archive) {
      return reply.status(404).send({ error: 'archive not found or expired' })
    }

    // Mark as downloaded and delete after sending
    await prisma.historyArchive.update({
      where: { id: archive.id },
      data: { downloaded: true }
    })

    // Auto-delete after download
    setTimeout(async () => {
      try {
        await prisma.historyArchive.delete({ where: { id: archive.id } })
      } catch (e) {
        console.error('Failed to delete archive:', e)
      }
    }, 1000)

    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Length', archive.size.toString())

    return reply.send(Buffer.from(archive.encryptedData))
  })
}

// Cleanup job - add this to your server/jobs directory as cleanup.ts
export async function cleanupExpiredData() {
  try {
    // Clean up expired linking sessions
    const expiredSessions = await prisma.linkingSession.deleteMany({
      where: {
        expiresAt: { lt: new Date() }
      }
    })

    // Clean up expired history archives
    const expiredArchives = await prisma.historyArchive.deleteMany({
      where: {
        expiresAt: { lt: new Date() }
      }
    })

    // Clean up expired provisioning messages
    await prisma.$executeRaw`
      DELETE FROM provisioning_messages WHERE expires_at < NOW()
    `

    console.log(`🧹 Cleanup: ${expiredSessions.count} sessions, ${expiredArchives.count} archives`)

  } catch (error) {
    console.error('Cleanup job failed:', error)
  }
}