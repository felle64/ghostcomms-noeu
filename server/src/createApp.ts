// server/src/createApp.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { JWT_SECRET } from './env'

export async function createApp() {
  const app = Fastify({ logger: false })

  // CORS — register ONCE here. Guard to avoid double-registration.
  if (!app.hasRequestDecorator('corsPreflightEnabled')) {
    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true)
        try {
          const host = new URL(origin).hostname
          const isLocal =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
            /\.githubpreview\.dev$/.test(host) ||
            host === (process.env.CLIENT_HOST || '')
          cb(null, isLocal)
        } catch {
          cb(null, false)
        }
      },
      credentials: true,
    })
  }

  await app.register(jwt, { secret: JWT_SECRET })
  return app
}
