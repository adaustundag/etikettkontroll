/**
 * Runs once when the Next.js server boots (nodejs runtime only).
 * - Applies pending versioned migrations (additive-only; non-destructive).
 *   For a pre-migration-history database the 0001_baseline is auto-resolved
 *   as applied (its SQL matches the schema that DB already runs) and the
 *   additive migrations then deploy. `migrate deploy` never drops data.
 * - Seeds demo data in DEVELOPMENT only.
 * - Installs the FTS search index.
 */
import { execSync } from 'child_process'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    console.log('[boot] applying pending migrations (additive, non-destructive)...')
    try {
      execSync('bun x prisma migrate deploy --schema prisma/schema.prisma', {
        stdio: 'inherit',
        env: process.env,
        cwd: process.cwd(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('P3005') || msg.includes('P3006')) {
        // Database predates the migration history → baseline it, then deploy.
        console.log('[boot] pre-migration database detected — baselining 0001_baseline as applied')
        execSync('bun x prisma migrate resolve --applied 0001_baseline --schema prisma/schema.prisma', {
          stdio: 'inherit',
          env: process.env,
        })
        execSync('bun x prisma migrate deploy --schema prisma/schema.prisma', { stdio: 'inherit', env: process.env })
      } else {
        throw err
      }
    }
  } catch (err) {
    console.error('[boot] migration failed:', err instanceof Error ? err.message : err)
  }
  try {
    const { seedDemoIfEmpty } = await import('@/lib/seed-demo')
    const { seeded } = await seedDemoIfEmpty()
    if (seeded) console.log('[boot] empty database — demo data seeded')
  } catch (err) {
    console.error('[boot] auto-seed failed:', err instanceof Error ? err.message : err)
  }
  try {
    // Backfills only NULL provenance/pointer fields — idempotent, non-destructive.
    const { runLaunchBackfill } = await import('@/lib/launch-backfill')
    const s = await runLaunchBackfill(true)
    console.log(
      `[boot] launch backfill: pointers=${s.pointerFixes} demo=${s.classifiedDemo} off=${s.classifiedOff} legacy=${s.classifiedLegacy} verified=${s.verifiedCount}`,
    )
  } catch (err) {
    console.error('[boot] launch backfill failed:', err instanceof Error ? err.message : err)
  }
  try {
    const { ensureSearchIndex } = await import('@/lib/search')
    const enabled = await ensureSearchIndex()
    if (enabled) console.log('[boot] product search index ready (FTS5 trigram)')
  } catch (err) {
    console.error('[boot] search index failed:', err instanceof Error ? err.message : err)
  }
}
