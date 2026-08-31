import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ barcode: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to join the discussion.' }, { status: 401 })
  const { barcode } = await params
  const body = (await req.json().catch(() => ({}))) as { body?: string }
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
