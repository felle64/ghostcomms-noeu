import { PrismaClient } from '@prisma/client'

/**
 * Cleanup expired envelopes from the database
 * This should be run periodically (e.g., every hour) to prevent database bloat
 */
export async function cleanupExpiredEnvelopes(prisma: PrismaClient): Promise<number> {
  const result = await prisma.envelope.deleteMany({
    where: {
      expiresAt: {
        lt: new Date()
      }
    }
  })

  console.log(`Cleaned up ${result.count} expired envelopes`)
  return result.count
}

// Run standalone when executed directly
if (require.main === module) {
  const prisma = new PrismaClient()
  cleanupExpiredEnvelopes(prisma)
    .then((count) => {
      console.log(`Successfully cleaned ${count} envelopes`)
      return prisma.$disconnect()
    })
    .catch((err) => {
      console.error('Cleanup failed:', err)
      process.exit(1)
    })
}
