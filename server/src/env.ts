import dotenv from 'dotenv'
dotenv.config()
export const PORT = Number(process.env.PORT || 8080)
export const JWT_SECRET = process.env.JWT_SECRET!
export const REGION = process.env.REGION || 'CH'
