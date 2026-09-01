import type { Metadata } from 'next'
import AppShellRoot from '@/components/ek/app-shell'
import { parsePath } from '@/lib/route'
import { siteUrl } from '@/lib/site'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug?: string[] }> }

/**
 * Page-level openGraph replaces the layout's (shallow metadata merge), so every
 * openGraph object here carries siteName/locale/images itself. Images point at
 * the /api/og card renderer (dynamic, SV copy, product cards via barcode).
 */
function og(title: string, description: string, path: string, ogImage?: string): Metadata['openGraph'] {
  return {
    title: `${title} – EtikettKontroll`,
    description,
    url: `${base(path)}`,
    type: 'website',
    siteName: 'EtikettKontroll',
    locale: 'sv_SE',
    images: [{ url: ogImage ?? '/api/og', width: 1200, height: 630, alt: title }],
  }
}

function base(path: string): string {
  return `${siteUrl()}${path}`
}

// Next delivers catch-all segments URL-decoded; parsePath decodes again, so
// re-encode to keep the transform symmetric with client-side pathname reads.
function routeFromSlug(slug: string[] | undefined) {
  const path = `/${(slug ?? []).map((s) => encodeURIComponent(s)).join('/')}`
  return parsePath(path)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const [view, param = ''] = slug ?? []

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
        const imgPath = `/api/og?barcode=${encodeURIComponent(barcode)}`
        return {
          title,
          description,
          alternates: { canonical: base(`/product/${encodeURIComponent(barcode)}`) },
          openGraph: og(title, description, `/product/${encodeURIComponent(barcode)}`, imgPath),
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
      alternates: { canonical: base('/submit') },
      openGraph: og('Lägg till produkt', 'Fota etiketten, skriv av uppgifterna och bidra till den granskade databasen.', '/submit'),
    }
  }

  if (view === 'queue') {
    return { title: 'Granskningskö', robots: { index: false, follow: false } }
  }

  if (view === 'profile' && param) {
    return { title: 'Bidragsgivarprofil', robots: { index: false, follow: true } }
  }

  if (view === 'andringar') {
    const description =
      'Loggen över alla granskade ändringar av matetiketter — vad som ändrats, av vem och när. Varje ändring kontrolleras av communityn.'
    return {
      title: 'Ändringar',
      description,
      alternates: { canonical: base('/andringar') },
      openGraph: og('Ändringar', description, '/andringar', '/api/og?title=Ändringar&sub=Hela%20loggen%20av%20granskade%20etikett%C3%A4ndringar'),
    }
  }

  if (view === 'om') {
    const description =
      'EtikettKontroll är en öppen, communitygranskad databas över vad matetiketter egentligen säger — ingredienser, näringsvärden och alla ändringar över tid.'
    return {
      title: 'Om',
      description,
      alternates: { canonical: base('/om') },
      openGraph: og('Om', description, '/om'),
    }
  }

  if (view === 'integritet') {
    return {
      title: 'Integritet',
      description:
        'Vilka uppgifter EtikettKontroll sparar, hur länge och dina rättigheter. Ingen analys, ingen annonsteknik, ingen försäljning av data.',
      alternates: { canonical: base('/integritet') },
    }
  }

  if (view === 'sa-funkar-verifiering') {
    const description =
      'Från foto till publicerad etikett: så fungerar granskningsflödet, förtroendenivåerna L0–L3 och vad som händer när granskarna inte är överens.'
    return {
      title: 'Så funkar verifiering',
      description,
      alternates: { canonical: base('/sa-funkar-verifiering') },
      openGraph: og('Så funkar verifiering', description, '/sa-funkar-verifiering'),
    }
  }

  return {}
}

export default async function AppRoute({ params }: Props) {
  const { slug } = await params
  return <AppShellRoot initialRoute={routeFromSlug(slug)} />
}
