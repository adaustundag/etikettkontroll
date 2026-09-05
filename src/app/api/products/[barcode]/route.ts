import { NextRequest, NextResponse } from 'next/server'
import { getProductAvailability, getProductDetail } from '@/lib/product-detail'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params
  // EK-01: quarantined records are withheld — the API explains instead of
  // serving the record (410 Gone: existed, deliberately withdrawn).
  const availability = await getProductAvailability(barcode)
  if (availability.state === 'quarantined') {
    return NextResponse.json(
      {
        error: 'This record is not publicly available (demo or test origin).',
        quarantined: true,
        barcode: availability.barcode,
        name: availability.name,
      },
      { status: 410 },
    )
  }
  const dto = await getProductDetail(barcode)
  if (!dto) return NextResponse.json({ error: 'Product not found.' }, { status: 404 })
  return NextResponse.json(dto)
}
