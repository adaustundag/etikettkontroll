/**
 * Runs once when the Next.js server boots (nodejs runtime only).
 * Fresh deployment convenience: an empty database gets the demo dataset.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { seedDemoIfEmpty } = await import('@/lib/seed-demo')
    const { seeded } = await seedDemoIfEmpty()
    if (seeded) console.log('[boot] empty database — demo data seeded')
  } catch (err) {
    console.error('[boot] auto-seed failed:', err instanceof Error ? err.message : err)
  }
}
