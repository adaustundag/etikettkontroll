import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { readBoundedJson } from '@/lib/payload'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ barcode: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to join the discussion.' }, { status: 401 })

  // Comment-flood bound: 10 per minute per user.
  const limited = enforceRateLimit(req, 'comment', 10, 60_000, user.id)
  if (limited) return limited

  const { barcode } = await params
  const body = (await readBoundedJson<{ body?: string }>(req, 16 * 1024)) ?? ({} as { body?: string })
  const text = (body.body || '').trim()
  if (text.length < 2) return NextResponse.json({ error: 'Comment is too short.' }, { status: 400 })
  if (text.length > 1000) return NextResponse.json({ error: 'Comment is too long (max 1000 characters).' }, { status: 400 })

  const product = await db.product.findUnique({ where: { barcode }, select: { id: true } })
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 })

  const comment = await db.productComment.create({
    data: { productId: product.id, userId: user.id, body: text },
    include: { user: { select: { id: true, name: true, karma: true, trustLevel: true } } },
  })

  return NextResponse.json({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    user: {
      id: comment.user.id,
      name: comment.user.name,
      karma: comment.user.karma,
      trustLevel: comment.user.trustLevel,
      trustLabel: ['Newcomer', 'Contributor', 'Trusted', 'Moderator'][Math.min(3, Math.max(0, comment.user.trustLevel))],
    },
  })
}
