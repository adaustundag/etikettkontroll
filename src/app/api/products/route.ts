import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { SubmitConflict, SubmitError, submitRevision } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'
import { PayloadTooLargeError, readBoundedJson } from '@/lib/payload'
import { searchProducts } from '@/lib/search'
import type { SubmitPayload, SubmitResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/products?q=&page=&pageSize= — search (FTS trigram w/ LIKE fallback)
// or, with an empty q, the recent-products list. Paginated.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const page = Number(req.nextUrl.searchParams.get('page')) || 1
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize')) || 20

  const result = await searchProducts({ q, page, pageSize })
  return NextResponse.json(result)
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
    if (err instanceof SubmitConflict) {
      // Optimistic concurrency: the product moved under the editor — never a
      // silent overwrite of newer data.
      return NextResponse.json(
        { error: err.message, conflict: true, currentRevisionId: err.currentRevisionId },
        { status: 409 },
      )
    }
    if (err instanceof SubmitError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('submit error', err)
    return NextResponse.json({ error: 'Submission failed. Please try again.' }, { status: 500 })
  }
}
