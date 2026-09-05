import { db } from '@/lib/db'
import { mapRevision, revisionInclude } from '@/lib/revisions'
import type { ProductDetailDTO } from '@/lib/types'

/**
 * Public availability of a barcode (EK-01): quarantined records exist but are
 * withheld from public view — the page and API must explain that instead of
 * serving the record's data.
 */
export type ProductAvailability =
  | { state: 'missing' }
  | { state: 'available' }
  | { state: 'quarantined'; barcode: string; name: string; reason: string | null }

export async function getProductAvailability(barcode: string): Promise<ProductAvailability> {
  const product = await db.product.findUnique({
    where: { barcode },
    select: { barcode: true, name: true, quarantined: true, currentRevisionId: true },
  })
  if (!product) return { state: 'missing' }
  if (product.quarantined) {
    const current = product.currentRevisionId
      ? await db.productRevision.findUnique({
          where: { id: product.currentRevisionId },
          select: { sourceType: true },
        })
      : null
    const sourceType = current?.sourceType ?? null
    return {
      state: 'quarantined',
      barcode: product.barcode,
      name: product.name,
      reason: sourceType === 'demo' ? 'demo' : sourceType,
    }
  }
  return { state: 'available' }
}

/**
 * Server-side product detail loader, shared by the REST route and the SSR
 * page render (so crawlers get the real content in the HTML, not an empty shell).
 * Returns null when no product has that barcode.
 */
export async function getProductDetail(barcode: string): Promise<ProductDetailDTO | null> {
  const product = await db.product.findUnique({
    where: { barcode },
    include: {
      revisions: { orderBy: { version: 'desc' }, include: revisionInclude },
      comments: {
        include: { user: { select: { id: true, name: true, karma: true, trustLevel: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!product) return null

  // Canonical current publication: the pointer is the source of truth; the
  // status-based fallback covers rows not yet migrated.
  const current = product.currentRevisionId
    ? (product.revisions.find((r) => r.id === product.currentRevisionId && ['approved', 'auto_approved'].includes(r.status)) ??
      product.revisions.find((r) => ['approved', 'auto_approved'].includes(r.status)) ??
      null)
    : (product.revisions.find((r) => r.status === 'approved' || r.status === 'auto_approved') ?? null)
  const reviewerCount = current
    ? new Set(current.reviews.filter((r) => r.verdict === 'approve').map((r) => r.reviewer.id)).size
    : 0
  const pendingCount = product.revisions.filter((r) => r.status === 'pending').length

  return {
    product: {
      id: product.id,
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    },
    current: current ? mapRevision(current) : null,
    revisions: product.revisions.map(mapRevision),
    comments: product.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      user: {
        id: c.user.id,
        name: c.user.name,
        karma: c.user.karma,
        trustLevel: c.user.trustLevel,
        trustLabel: ['Newcomer', 'Contributor', 'Trusted', 'Moderator'][Math.min(3, Math.max(0, c.user.trustLevel))],
      },
    })),
    reviewerCount,
    pendingCount,
  }
}
