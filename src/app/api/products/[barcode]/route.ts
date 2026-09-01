import { NextRequest, NextResponse } from 'next/server'
import { getProductDetail } from '@/lib/product-detail'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params
  const dto = await getProductDetail(barcode)
  if (!dto) return NextResponse.json({ error: 'Product not found.' }, { status: 404 })
  return NextResponse.json(dto)
}
