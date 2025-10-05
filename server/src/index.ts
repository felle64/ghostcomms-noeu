// src/index.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { createApp } from './createApp'
import { registerHttpRoutes } from './routes'
import { attachWs } from './ws'

const PORT = Number(process.env.PORT || 8080)

async function main() {
  const prisma = new PrismaClient()
  const app = await createApp()
  await registerHttpRoutes(app, prisma)
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`GhostComms • NoEU relay on :${PORT}`)
  attachWs(app, prisma)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
