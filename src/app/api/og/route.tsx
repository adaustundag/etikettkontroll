import { NextRequest } from 'next/server'
import { ImageResponse } from 'next/og'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Dynamic Open Graph card (1200x630). Used via openGraph.images:
 *   /api/og                        -> branded default
 *   /api/og?title=...&sub=...      -> custom headline card
 *   /api/og?barcode=<barcode>      -> product card (name + brand from DB)
 * Satori layout: explicit flex only, no shorthand CSS.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const barcode = sp.get('barcode')

  let title = sp.get('title') || 'Vad står egentligen på etiketten?'
  let subtitle = sp.get('sub') || 'Granskad databas för matetiketter'

  if (barcode && /^\d{4,14}$/.test(barcode)) {
    try {
      const p = await db.product.findUnique({
        where: { barcode },
        select: { name: true, brand: true },
      })
      if (p) {
        title = p.name
        subtitle = p.brand || 'EtikettKontroll'
      }
    } catch {
      // DB not ready — keep the requested/default copy
    }
  }
  if (title.length > 80) title = `${title.slice(0, 79)}…`
  if (subtitle.length > 60) subtitle = `${subtitle.slice(0, 59)}…`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: 'linear-gradient(135deg, #064e3b 0%, #059669 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: '#ffffff',
              color: '#059669',
              fontSize: '30px',
              fontWeight: 700,
            }}
          >
            |||
          </div>
          <div style={{ display: 'flex', fontSize: '40px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            EtikettKontroll
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', fontSize: barcode ? '60px' : '68px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {title}
          </div>
          <div style={{ display: 'flex', fontSize: '32px', color: '#a7f3d0' }}>{subtitle}</div>
        </div>

        <div style={{ display: 'flex', fontSize: '24px', color: '#d1fae5' }}>EtikettKontroll</div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
