import { readdirSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { uploadsDir } from '@/lib/uploads'

/**
 * One-shot surgical cleanup of QA litter left by the T10 budget probe
 * (worklog Task 30 era): 3 probe accounts and their test uploads.
 *
 * Guards so this can never remove anything else:
 *  - accounts: matched by EXACT email AND required to have zero revisions,
 *    reviews, comments and karma events (contribution-free probes only);
 *  - files: matched by the probe run's unique timestamp prefix `mtngk` AND
 *    verified to be referenced by no revision field before unlinking.
 *
 * The probe window (mtngk*) predates all other production uploads, so the
 * pattern narrows to nothing after one run and subsequent boots are no-ops.
 */

const PROBE_EMAILS = [
  'qa-critique-9f3@example.com',
  'probe-p4@x.se',
  'budget-prod-1@example.com',
  'budget-local-1@example.com',
  'budget-local-2@example.com',
]
const PROBE_FILE_PREFIX = /^mtngk[a-z0-9]{2,4}-[a-f0-9-]+\.(jpe?g|png|webp)$/

export async function removeProbeLitter(): Promise<{ usersRemoved: number; filesRemoved: number }> {
  let usersRemoved = 0
  let filesRemoved = 0
  try {
    // --- accounts (contribution-free probe accounts only) ---
    const probes = await db.user.findMany({
      where: { email: { in: PROBE_EMAILS.map((e) => e.toLowerCase()) } },
      select: {
        id: true,
        email: true,
        _count: { select: { revisions: true, reviews: true, comments: true, karmaEvents: true } },
      },
    })
    for (const u of probes) {
      const c = u._count
      if (c.revisions + c.reviews + c.comments + c.karmaEvents > 0) {
        console.warn(`[cleanup] skipping ${u.email}: has contribution rows, not a probe`)
        continue
      }
      await db.user.delete({ where: { id: u.id } })
      usersRemoved++
      console.log(`[cleanup] removed probe account ${u.email}`)
    }

    // --- upload files (probe timestamp window, unreferenced only) ---
    const referenced = new Set<string>()
    const revs = await db.productRevision.findMany({
      select: { frontImage: true, ingredientsImage: true, nutritionImage: true },
    })
    for (const r of revs) {
      for (const ref of [r.frontImage, r.ingredientsImage, r.nutritionImage]) {
        if (ref) referenced.add(path.basename(ref))
      }
    }

    const dir = uploadsDir()
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!PROBE_FILE_PREFIX.test(name) || referenced.has(name)) continue
        try {
          unlinkSync(path.join(dir, name))
          filesRemoved++
        } catch {
          // already gone / locked — not fatal
        }
      }
    }
    if (filesRemoved > 0) console.log(`[cleanup] removed ${filesRemoved} probe upload file(s)`)
  } catch (err) {
    console.error('[cleanup] probe litter removal failed (non-fatal):', err instanceof Error ? err.message : err)
  }
  return { usersRemoved, filesRemoved }
}
