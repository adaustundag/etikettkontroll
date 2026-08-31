import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging is for dev debugging; `bun test` sets NODE_ENV=test and
    // would otherwise drown test output in SQL noise.
    log: process.env.NODE_ENV === 'test' ? [] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db