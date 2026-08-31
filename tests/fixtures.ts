/**
 * Shared test fixtures: database wipe + factories for users, products and
 * revisions. Import AFTER ../setup (which selects the test database).
 */
import { db } from '@/lib/db'
import { computeTrust, type TrustInfo } from '@/lib/trust'

let seq = 0

/** Random 13-digit barcode, unique within the run. */
export function uniqBarcode(): string {
  seq += 1
  const n = 7300000000000 + ((Date.now() % 1000000) * 97 + seq * 131) % 999999999
  return String(n).padStart(13, '7')
}

let uniqCounter = 0
function uniqEmail(prefix: string): string {
  uniqCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uniqCounter}@test.se`
}

/** Delete every row, children first (FK order). */
export async function wipeDb() {
  await db.karmaEvent.deleteMany()
  await db.review.deleteMany()
  await db.magicToken.deleteMany()
  await db.externalIdentity.deleteMany()
  await db.productComment.deleteMany()
  await db.productRevision.deleteMany()
  await db.product.deleteMany()
  await db.user.deleteMany()
}

type HistorySpec = { approved?: number; rejected?: number }

/**
 * Create a user and (optionally) a revision history so that computeTrust
 * derives the intended Option-B level from real data:
 *   L1 = karma ≥ 30;  L2 = karma ≥ 100 + 3 finalized + ≥85% approved;
 *   L3 = karma ≥ 250 + 5 finalized + ≥90% approved.
 */
export async function mkUser(
  opts: { name?: string; email?: string; karma?: number; history?: HistorySpec; passwordHash?: string | null } = {},
): Promise<{ id: string; name: string; email: string; karma: number; trust: TrustInfo }> {
  const user = await db.user.create({
    data: {
      name: opts.name ?? 'Test User',
      email: opts.email ?? uniqEmail('user'),
      passwordHash: opts.passwordHash === undefined ? 'deadbeef:cafe' : opts.passwordHash,
      karma: opts.karma ?? 0,
    },
  })

  const approved = opts.history?.approved ?? 0
  const rejected = opts.history?.rejected ?? 0
  const makeHistory = async (status: 'approved' | 'rejected', count: number) => {
    for (let i = 0; i < count; i++) {
      const p = await db.product.create({
        data: { barcode: uniqBarcode(), name: `History item ${seq}`, brand: 'History' },
      })
      await db.productRevision.create({
        data: {
          productId: p.id,
          version: 1,
          submittedById: user.id,
          name: p.name,
          brand: 'History',
          ingredients: 'water',
          status,
          finalizedAt: new Date(),
        },
      })
    }
  }
  await makeHistory('approved', approved)
  await makeHistory('rejected', rejected)

  // Let the real trust engine derive + write back the cached level.
  const trust = await computeTrust(user.id)
  return { id: user.id, name: user.name, email: user.email, karma: user.karma, trust }
}

/** Create a product with one approved (published) revision. */
export async function mkProduct(
  opts: {
    name: string
    brand: string
    barcode?: string
    authorId: string
    ingredients?: string
    frontImage?: string | null
  },
) {
  const product = await db.product.create({
    data: { barcode: opts.barcode ?? uniqBarcode(), name: opts.name, brand: opts.brand },
  })
  const revision = await db.productRevision.create({
    data: {
      productId: product.id,
      version: 1,
      submittedById: opts.authorId,
      name: opts.name,
      brand: opts.brand,
      ingredients: opts.ingredients ?? 'water, salt',
      frontImage: opts.frontImage ?? null,
      status: 'approved',
      finalizedAt: new Date(),
    },
  })
  return { product, revision }
}

/** Create a pending revision on an existing product at the next version. */
export async function mkPending(
  opts: {
    productId: string
    authorId: string
    name?: string
    brand?: string
    ingredients?: string
    requiredApprovals?: number
    createdAt?: Date
  },
) {
  const last = await db.productRevision.findFirst({
    where: { productId: opts.productId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return db.productRevision.create({
    data: {
      productId: opts.productId,
      version: (last?.version ?? 0) + 1,
      submittedById: opts.authorId,
      name: opts.name ?? 'Pending name',
      brand: opts.brand ?? 'Pending brand',
      ingredients: opts.ingredients ?? 'water, salt, pepper',
      status: 'pending',
      requiredApprovals: opts.requiredApprovals ?? 2,
      changedFields: JSON.stringify(['name']),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
}

/** Convenience: full submit payload accepted by POST /api/products. */
export function submitPayload(over: Partial<Record<string, unknown>> = {}) {
  return {
    barcode: uniqBarcode(),
    name: 'Test Kaviar',
    brand: 'TestFoods',
    ingredients: 'sugar, rapeseed oil, water, salt',
    ...over,
  }
}
