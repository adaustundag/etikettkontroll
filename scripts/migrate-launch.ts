/**
 * Launch-readiness migration: classify provenance, derive verification, and
 * install canonical current-publication pointers for EXISTING records.
 *
 *   DATABASE_URL=file:/data/db/custom.db bun scripts/migrate-launch.ts           # DRY RUN (default)
 *   DATABASE_URL=file:/data/db/custom.db bun scripts/migrate-launch.ts --apply   # write changes
 *
 * Idempotent: only touches rows whose target fields are still unset; running
 * twice produces no additional changes. Never deletes or overwrites history.
 *
 * Classification rules:
 *  - submittedBy email @etikettkontroll.se (seed demo users) → sourceType 'demo'
 *  - submittedBy = OFF import bot                            → 'openfoodfacts'
 *    (+ sourceId/sourceUrl/importedAt/license metadata from the import era)
 *  - everything before this migration                        → 'unknown_legacy'
 *  - verifiedAt is granted ONLY when a revision has human reviews AND the
 *    evidence photos its changed fields require. Old "approved" status alone
 *    never confers verification. Demo-sourced revisions are never verified.
 */
import { PrismaClient } from '@prisma/client'
import { evidenceCoverage } from '../src/lib/revisions'

const apply = process.argv.includes('--apply')
const db = new PrismaClient()

const DEMO_DOMAIN = '@etikettkontroll.se'
const BOT_EMAIL = 'off-import@etikettkontroll.se'
const NUTRITION_FIELDS = ['servingSize', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']

type RevRow = {
  id: string
  productId: string
  version: number
  status: string
  finalizedAt: Date | null
  createdAt: Date
  changedFields: string
  frontImage: string | null
  ingredientsImage: string | null
  nutritionImage: string | null
  sourceType: string
  verifiedAt: Date | null
  reviews: { reviewerId: string }[]
  submitterEmail: string
}

const products = await db.product.findMany({
  select: { id: true, barcode: true, currentRevisionId: true, quarantined: true },
})
const revisions = (await db.productRevision.findMany({
  select: {
    id: true,
    productId: true,
    version: true,
    status: true,
    finalizedAt: true,
    createdAt: true,
    changedFields: true,
    frontImage: true,
    ingredientsImage: true,
    nutritionImage: true,
    sourceType: true,
    verifiedAt: true,
    reviews: { select: { reviewerId: true } },
    submittedBy: { select: { email: true } },
  },
  orderBy: { version: 'asc' },
})).map((r) => ({ ...r, submitterEmail: r.submittedBy?.email ?? '' })) as RevRow[]

const byProduct = new Map<string, RevRow[]>()
for (const r of revisions) {
  const list = byProduct.get(r.productId) ?? []
  list.push(r)
  byProduct.set(r.productId, list)
}

let pointerFixes = 0
let classifiedDemo = 0
let classifiedOff = 0
let classifiedLegacy = 0
let verifiedCount = 0
const quarantineCandidates: string[] = []

for (const p of products) {
  const revs = byProduct.get(p.id) ?? []

  // 1. Canonical current-publication pointer.
  if (!p.currentRevisionId) {
    const latestPublished = [...revs]
      .filter((r) => ['approved', 'auto_approved'].includes(r.status))
      .sort((a, b) => b.version - a.version)[0]
    if (latestPublished) {
      pointerFixes++
      if (apply) await db.product.update({ where: { id: p.id }, data: { currentRevisionId: latestPublished.id } })
    }
  }

  for (const r of revs) {
    // 2. Structured provenance — the OFF bot is identified BEFORE the demo
    // domain rule (its address shares the demo domain).
    const email = r.submitterEmail.toLowerCase()
    let sourceType: string | null = null
    let sourceId: string | null = null
    let sourceUrl: string | null = null
    let importedAt: Date | null = null
    let licenseData: string | null = null
    let licenseImages: string | null = null
    if (email === BOT_EMAIL) {
      sourceType = 'openfoodfacts'
      const product = products.find((pp) => pp.id === r.productId)
      sourceId = product?.barcode ?? null
      sourceUrl = product ? `https://world.openfoodfacts.org/product/${product.barcode}` : null
      importedAt = r.createdAt
      licenseData = 'OFF Database Contents License (DbCL v1.0); database licensed ODbL'
      licenseImages = 'CC BY-SA 4.0 (Open Food Facts contributors)'
    } else if (email.endsWith(DEMO_DOMAIN)) {
      sourceType = 'demo'
    } else {
      sourceType = 'unknown_legacy'
    }

    const needsClassification = r.sourceType === 'human' || r.sourceType === '' || (r.sourceType === 'demo' && email === BOT_EMAIL)
    if (needsClassification) {
      if (sourceType === 'demo') classifiedDemo++
      else if (sourceType === 'openfoodfacts') classifiedOff++
      else classifiedLegacy++
      if (apply) {
        await db.productRevision.update({
          where: { id: r.id },
          data: { sourceType, sourceId, sourceUrl, importedAt, licenseData, licenseImages },
        })
      }
    }

    // 3. Verification — evidence + human review required; demo never verifies.
    if (r.verifiedAt === null && r.sourceType !== 'demo' && ['approved', 'auto_approved', 'superseded'].includes(r.status)) {
      let changed: string[] = []
      try {
        changed = JSON.parse(r.changedFields) as string[]
      } catch {
        changed = []
      }
      const effective = changed.length ? changed : ['ingredients']
      const coverage = evidenceCoverage(r)
      const needsIngredient = effective.some((f) => f === 'ingredients' || f === 'ingredientsImage')
      const needsNutrition = effective.some((f) => NUTRITION_FIELDS.includes(f))
      const needsFront = effective.some((f) => f === 'name' || f === 'brand' || f === 'frontImage')
      const evidenceOk =
        (!needsIngredient || coverage.ingredients) &&
        (!needsNutrition || coverage.nutrition) &&
        (!needsFront || coverage.front)
      const humanReviews = r.reviews.length > 0
      if (evidenceOk && humanReviews && sourceType !== 'demo') {
        verifiedCount++
        if (apply) {
          await db.productRevision.update({
            where: { id: r.id },
            data: { verifiedAt: r.finalizedAt ?? r.createdAt },
          })
        }
      }
    }

    // 4. Quarantine candidates reported, never auto-applied.
    if (sourceType === 'openfoodfacts' && r.status === 'auto_approved' && r.ingredientsImage === null && !p.quarantined) {
      if (!quarantineCandidates.includes(p.barcode)) quarantineCandidates.push(p.barcode)
    }
  }
}

const mode = apply ? 'APPLY' : 'DRY RUN'
console.log(`Launch-readiness migration — mode: ${mode}`)
console.log(`products scanned:            ${products.length}`)
console.log(`revisions scanned:           ${revisions.length}`)
console.log(`current pointers set:        ${pointerFixes}`)
console.log(`classified demo:             ${classifiedDemo}`)
console.log(`classified openfoodfacts:    ${classifiedOff}`)
console.log(`classified unknown_legacy:   ${classifiedLegacy}`)
console.log(`verification stamps granted: ${verifiedCount} (requires human reviews + evidence)`)
console.log(`quarantine candidates (manual decision, not applied): ${quarantineCandidates.length}`)
if (quarantineCandidates.length > 0) console.log(quarantineCandidates.slice(0, 20).join(', '))

// 5. Search/stats note: the FTS index syncs via triggers on name/brand; this
// migration does not alter names, and quarantine/currency filters are applied
// at query time — no rebuild required. Re-running this script is a no-op.
if (!apply) console.log('\nDry run only — re-run with --apply to write the changes above.')
await db.$disconnect()
