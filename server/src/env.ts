import dotenv from 'dotenv'
dotenv.config()

const DEFAULT_ORIGINS = [
  'https://app.nfktech.com',
  'http://localhost:5173',
]

const corsOverride = (process.env.CORS_ORIGINS || '').split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const PORT = Number(process.env.PORT || 8080)
export const JWT_SECRET = process.env.JWT_SECRET!
export const REGION = process.env.REGION || 'CH'
export const CORS_ORIGINS = (corsOverride.length ? corsOverride : DEFAULT_ORIGINS)
