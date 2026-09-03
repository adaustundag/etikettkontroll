import { db } from '@/lib/db'

/**
 * Development convenience: if the local database has no users, load the demo
 * dataset (the same as `bun prisma/seed.ts`).
 *
 * PRODUCTION NEVER SEEDS — no opt-in flag can enable it. Demo users carry
 * public passwords and must not exist on a real deployment.
 */
export async function seedDemoIfEmpty(): Promise<{ seeded: boolean }> {
  if (process.env.NODE_ENV === 'production') return { seeded: false }
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
