import { db } from '@/lib/db'

/**
 * Boot-time convenience for fresh deployments: if the database has no users,
 * load the demo dataset (the same as `bun prisma/seed.ts`).
 * Disable with EK_AUTO_SEED=0.
 */
export async function seedDemoIfEmpty(): Promise<{ seeded: boolean }> {
  if (process.env.EK_AUTO_SEED === '0') return { seeded: false }
  try {
    const users = await db.user.count()
    if (users > 0) return { seeded: false }
    const { seedDemo } = await import('../../prisma/seed')
    await seedDemo()
    return { seeded: true }
  } catch (err) {
    console.error('[seed-demo] skipped:', err instanceof Error ? err.message : err)
    return { seeded: false }
  }
}
