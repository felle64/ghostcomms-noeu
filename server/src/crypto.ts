import crypto from 'crypto'

export function hashPassword(password: string, salt: string): string {
  // Using PBKDF2 with high iterations for security
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

export function generateSalt(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const testHash = hashPassword(password, salt)
  return crypto.timingSafeEqual(Buffer.from(testHash), Buffer.from(hash))
}

export function generateDeviceId(): string {
  return crypto.randomBytes(16).toString('hex')
}