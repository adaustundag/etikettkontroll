import type { Metadata } from 'next'
import AppShellRoot from '@/components/ek/app-shell'
import { parsePath } from '@/lib/route'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug?: string[] }> }

// Next delivers catch-all segments URL-decoded; parsePath decodes again, so
// re-encode to keep the transform symmetric with client-side pathname reads.
function routeFromSlug(slug: string[] | undefined) {
  const path = `/${(slug ?? []).map((s) => encodeURIComponent(s)).join('/')}`
  return parsePath(path)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const [view, param = ''] = slug ?? []
  const base = siteUrl()

  if (view === 'product' && param) {
    let barcode = param
    try {
      barcode = decodeURIComponent(param)
    } catch {
      // keep raw
    }
    try {
      const p = await db.product.findUnique({
        where: { barcode },
        select: { name: true, brand: true },
      })
      if (p) {
        const title = `${p.name}${p.brand ? ` – ${p.brand}` : ''}`
        const description = `Granskade uppgifter om ${p.name}: ingredienser, näringsvärden och alla ändringar av etiketten. Varje ändring kontrolleras av communityn innan den publiceras.`
        return {
          title,
          description,
          alternates: { canonical: `${base}/product/${encodeURIComponent(barcode)}` },
          openGraph: {
            title: `${title} – EtikettKontroll`,
            description,
            url: `${base}/product/${encodeURIComponent(barcode)}`,
            type: 'website',
          },
        }
      }
      return { title: 'Produkten hittades inte', robots: { index: false, follow: true } }
    } catch {
      // DB not ready (e.g. cold boot) — fall through to site defaults
    }
  }

  if (view === 'submit') {
    return {
      title: 'Lägg till produkt',
      description:
        'Fota etiketten, skriv av uppgifterna och bidra till den granskade databasen. L2-bidragsgivare publicerar direkt.',
    }
  }

  if (view === 'queue') {
    return { title: 'Granskningskö', robots: { index: false, follow: false } }
  }

  if (view === 'profile' && param) {
    return { title: 'Bidragsgivarprofil', robots: { index: false, follow: true } }
  }

  return {}
}

export default async function AppRoute({ params }: Props) {
  const { slug } = await params
  return <AppShellRoot initialRoute={routeFromSlug(slug)} />
}
