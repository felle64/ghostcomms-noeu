// src/createApp.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { JWT_SECRET } from './env'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'


const ALLOWED_ORIGINS = new Set([
  'https://app.nfktech.com',
  'http://localhost:5173',
])

export async function createApp() {
  const app = Fastify({ logger: false })

  // 1) CORS plugin (handles OPTIONS automatically)
  await app.register(cors, {
    origin: (origin, cb) => {
      // allow same-origin (no Origin header) and explicit allowlist
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true)
      cb(null, false)
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  })

  // 2) Add CORS headers even on 404/405, etc. (no duplicate OPTIONS!)
  app.addHook('onSend', (req, reply, payload, done) => {
    const o = req.headers.origin
    if (o && ALLOWED_ORIGINS.has(o)) {
      reply.header('Access-Control-Allow-Origin', o)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Credentials', 'true')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    }
    done()
  })


  await app.register(helmet, {
    contentSecurityPolicy: false, // front-end is on separate domain
    global: true,
  })

  await app.register(rateLimit, {
    max: 200,       // tune per IP burst
    timeWindow: '1 minute',
    allowList: [],  // add your own IP if needed
  })



  await app.register(jwt, { secret: JWT_SECRET })

  return app
}
