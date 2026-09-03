/**
 * Launch-readiness backfill (T2/T4/T6): idempotently classifies provenance,
 * derives verification (human reviews + evidence required), and installs
 * canonical current-publication pointers. Only touches rows whose target
 * fields are still NULL — running repeatedly produces no additional changes.
 *
 * Rule order matters: the OFF import bot is identified BEFORE the demo domain
 * rule (its address shares the demo email domain).
 */
import { db } from '@/lib/db'
import { evidenceCoverage } from '@/lib/revisions'

const DEMO_DOMAIN = '@etikettkontroll.se'
export const BOT_EMAIL = 'off-import@etikettkontroll.se'
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

export type BackfillSummary = {
  products: number
  revisions: number
  pointerFixes: number
  classifiedDemo: number
  classifiedOff: number
  classifiedLegacy: number
  verifiedCount: number
  quarantineCandidates: number
}

export async function runLaunchBackfill(apply: boolean): Promise<BackfillSummary> {
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
  let quarantineCandidates = 0

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
      // 2. Structured provenance.
      const email = r.submitterEmail.toLowerCase()
      let sourceType: string
      let sourceId: string | null = null
      let sourceUrl: string | null = null
      let importedAt: Date | null = null
      let licenseData: string | null = null
      let licenseImages: string | null = null
      if (email === BOT_EMAIL) {
        sourceType = 'openfoodfacts'
        sourceId = p.barcode
        sourceUrl = `https://world.openfoodfacts.org/product/${p.barcode}`
        importedAt = r.createdAt
        licenseData = 'OFF Database Contents License (DbCL v1.0); database licensed ODbL'
        licenseImages = 'CC BY-SA 4.0 (Open Food Facts contributors)'
      } else if (email.endsWith(DEMO_DOMAIN)) {
        sourceType = 'demo'
      } else {
        sourceType = 'unknown_legacy'
      }

      const needsClassification =
        r.sourceType === 'human' || r.sourceType === '' || (r.sourceType === 'demo' && email === BOT_EMAIL)
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

      // 3. Verification — evidence + human reviews required; demo never verifies.
      if (
        r.verifiedAt === null &&
        r.sourceType !== 'demo' &&
        ['approved', 'auto_approved', 'superseded'].includes(r.status)
      ) {
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

      // 4. Quarantine candidates counted, never auto-applied.
      if (sourceType === 'openfoodfacts' && r.status === 'auto_approved' && r.ingredientsImage === null && !p.quarantined) {
        quarantineCandidates++
      }
    }
  }

  return {
    products: products.length,
    revisions: revisions.length,
    pointerFixes,
    classifiedDemo,
    classifiedOff,
    classifiedLegacy,
    verifiedCount,
    quarantineCandidates,
  }
}
