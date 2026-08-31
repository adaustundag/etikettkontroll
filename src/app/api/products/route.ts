import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { SubmitError, submitRevision } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'
import { PayloadTooLargeError, readBoundedJson } from '@/lib/payload'
import type { SubmitPayload, SubmitResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/products?q= — search by barcode or name/brand (case-insensitive)
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const take = 20

  let products: Array<{
    id: string
    barcode: string
    name: string
    brand: string
    createdAt: Date
    updatedAt: Date
    revisions: { frontImage: string | null }[]
    _count: { revisions: number }
  }>

  if (q) {
    // Prisma's `contains` is case-sensitive on SQLite, so match with LIKE
    // (case-insensitive for ASCII) and then re-hydrate with relations in the
    // same order. % and _ in the query are treated literally via ESCAPE.
    const like = `%${q.replace(/[%_\\]/g, '')}%`
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM Product
      WHERE barcode LIKE ${like} OR name LIKE ${like} OR brand LIKE ${like}
      ORDER BY updatedAt DESC
      LIMIT ${take}`
    const ids = rows.map((r) => r.id)
    const found = await db.product.findMany({
      where: { id: { in: ids } },
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
    const byId = new Map(found.map((p) => [p.id, p]))
    products = []
    for (const id of ids) {
      const p = byId.get(id)
      if (p) products.push(p)
    }
  } else {
    products = await db.product.findMany({
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
  }

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

  // Submission flood bound: 20 per minute per user.
  const limited = enforceRateLimit(req, 'submit', 20, 60_000, user.id)
  if (limited) return limited

  try {
    const payload = (await readBoundedJson<SubmitPayload>(req, 256 * 1024)) ?? ({} as SubmitPayload)
    const result: SubmitResult = await submitRevision(user, payload)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 })
    }
    if (err instanceof SubmitError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('submit error', err)
    return NextResponse.json({ error: 'Submission failed. Please try again.' }, { status: 500 })
  }
}
