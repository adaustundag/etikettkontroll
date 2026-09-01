import { db } from '@/lib/db'
import { mapRevision, revisionInclude } from '@/lib/revisions'
import type { ProductDetailDTO } from '@/lib/types'

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

  const current =
    product.revisions.find((r) => r.status === 'approved' || r.status === 'auto_approved') ?? null
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
