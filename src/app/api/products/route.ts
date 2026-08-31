import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { SubmitError, submitRevision } from '@/lib/revisions'
import type { SubmitPayload, SubmitResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/products?q= — search by barcode or name/brand
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const take = 20

  const where = q
    ? /^\d{8,14}$/.test(q)
      ? { OR: [{ barcode: q }, { barcode: { contains: q } }, { name: { contains: q } }, { brand: { contains: q } }] }
      : { OR: [{ name: { contains: q } }, { brand: { contains: q } }] }
    : undefined

  const products = await db.product.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
    include: {
      revisions: {
        where: { status: { in: ['approved', 'auto_approved'] } },
        orderBy: { version: 'desc' },
        take: 1,
        select: { frontImage: true },
      },
      _count: { select: { revisions: { where: { status: { in: ['approved', 'auto_approved'] } } } } },
    },
  })

  return NextResponse.json(
    products.map((p) => ({
      id: p.id,
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      hasImage: (p.revisions[0]?.frontImage ?? null) !== null,
      approvedCount: p._count.revisions,
    })),
  )
}

// POST /api/products — create a product (or submit a revision of an existing one)
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to submit products.' }, { status: 401 })
  try {
    const payload = (await req.json()) as SubmitPayload
    const result: SubmitResult = await submitRevision(user, payload)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SubmitError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('submit error', err)
    return NextResponse.json({ error: 'Submission failed. Please try again.' }, { status: 500 })
  }
}
