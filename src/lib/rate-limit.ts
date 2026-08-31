import { NextRequest, NextResponse } from 'next/server'

/**
 * Minimal in-memory sliding-window rate limiter for the single-process
 * deployment (SQLite on one Railway instance). Each key keeps a log of recent
 * hit timestamps; the bucket map itself is bounded so a flood of unique keys
 * cannot grow memory forever (audit finding: per-process maps were unbounded).
 *
 * Skipped under bun test (NODE_ENV=test) and opt-out via EK_RATE_LIMIT=0.
 * Per-process only — fine for v1; move to Redis when we scale past one box.
 */
const buckets = new Map<string, number[]>()
const MAX_BUCKETS = 10_000

/** First hop of X-Forwarded-For (set by the Railway/proxy edge), then X-Real-IP. */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || 'unknown'
  return req.headers.get('x-real-ip') || 'unknown'
}

export type RateLimitResult = { ok: boolean; retryAfter: number }

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (process.env.EK_RATE_LIMIT === '0' || process.env.NODE_ENV === 'test') {
    return { ok: true, retryAfter: 0 }
  }
  const now = Date.now()
  const windowStart = now - windowMs
  const hits = (buckets.get(key) || []).filter((ts) => ts > windowStart)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return { ok: false, retryAfter: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) }
  }
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > MAX_BUCKETS) {
    // Map iterates in insertion order: evict oldest keys until back under cap.
    for (const k of buckets.keys()) {
      buckets.delete(k)
      if (buckets.size <= MAX_BUCKETS) break
    }
  }
  return { ok: true, retryAfter: 0 }
}

/**
 * Returns a 429 response when the limit is hit, else null (callers: `if (limited) return limited`).
 * `subject` defaults to the client IP; pass a user id for authenticated routes.
 */
export function enforceRateLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowMs: number,
  subject?: string,
): NextResponse | null {
  const res = rateLimit(`${bucket}:${subject ?? clientIp(req)}`, limit, windowMs)
  if (res.ok) return null
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(res.retryAfter) } },
  )
}
