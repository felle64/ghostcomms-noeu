import dotenv from 'dotenv'
dotenv.config()

export const PORT = Number(process.env.PORT || 8080)

// Validate JWT_SECRET
const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.trim().length < 32) {
  throw new Error(
    'JWT_SECRET must be set in environment and be at least 32 characters long. ' +
    'Generate one with: openssl rand -hex 64'
  )
}
export const JWT_SECRET = JWT_SECRET_RAW.trim()

export const REGION = process.env.REGION || 'CH'

// Validate database URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in environment')
}

export const EPHEMERAL_TTL_SECONDS = Number(process.env.EPHEMERAL_TTL_SECONDS || 86400)
