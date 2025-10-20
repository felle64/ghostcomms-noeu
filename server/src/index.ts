// src/index.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { createApp } from './createApp'
import { registerHttpRoutes } from './routes'
import { attachWs } from './ws'
import { cleanupExpiredEnvelopes } from './jobs/cleanupExpiredEnvelopes'

const PORT = Number(process.env.PORT || 8080)

async function main() {
  const prisma = new PrismaClient()
  const app = await createApp()
  await registerHttpRoutes(app, prisma)
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`GhostComms • NoEU relay on :${PORT}`)
  attachWs(app, prisma)

  // Run cleanup every hour
  setInterval(() => {
    cleanupExpiredEnvelopes(prisma).catch((err) => {
      console.error('Envelope cleanup error:', err)
    })
  }, 3600000) // 1 hour

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...')
    await prisma.$disconnect()
    await app.close()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing connections...')
    await prisma.$disconnect()
    await app.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
