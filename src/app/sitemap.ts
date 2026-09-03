import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/submit`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/andringar`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${base}/sok`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/beta`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/sa-funkar-verifiering`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/om`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/integritet`, changeFrequency: 'monthly', priority: 0.3 },
  ]
  try {
    const products = await db.product.findMany({
      select: { barcode: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    })
    for (const p of products) {
      entries.push({
        url: `${base}/product/${p.barcode}`,
        lastModified: p.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
  } catch {
    // DB not ready (cold boot) — serve the static entries only
  }
  return entries
}
