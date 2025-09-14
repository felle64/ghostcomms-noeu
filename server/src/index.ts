import './env'
import { PrismaClient } from '@prisma/client'
import { createApp } from './createApp'
import { registerHttpRoutes } from './routes'
import { attachWs } from './ws'
import { PORT } from './env'


const prisma = new PrismaClient()
const app = await createApp()
await registerHttpRoutes(app, prisma)




await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`GhostComms • NoEU relay on :${PORT}`)


attachWs(app, prisma)
