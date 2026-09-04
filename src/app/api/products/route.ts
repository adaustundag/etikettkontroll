import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { SubmitConflict, SubmitError, submitRevision } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'
import { payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'
import { searchProducts } from '@/lib/search'
import type { SubmitResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/products?q=&page=&pageSize= — search (FTS trigram w/ LIKE fallback)
// or, with an empty q, the recent-products list. Paginated.
// Route-level budgets (30F keeps searchProducts' SQL untouched): absent
// params keep defaults; supplied values must be finite integers or they are
// rejected back to the default — `Number('Infinity')` and the `Number(null)`
// = 0 trap are both avoided explicitly.
function intParam(sp: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = sp.get(name)
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 256)
  const page = intParam(req.nextUrl.searchParams, 'page', 1, 1, 500)
  const pageSize = intParam(req.nextUrl.searchParams, 'pageSize', 20, 1, 50)

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

  let payload: Record<string, unknown>
  try {
    payload = await readBoundedJsonObject(req, 256 * 1024)
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    throw err
  }

  try {
    const result: SubmitResult = await submitRevision(user, payload as never)
    return NextResponse.json(result)
  } catch (err) {
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
