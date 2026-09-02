import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { APP_VERSION } from '@/lib/site'

export const dynamic = 'force-dynamic'

const BOOT = Date.now()

/**
 * Health/readiness probe (Railway health check path). Verifies the database
 * actually answers — a green response means the app can serve traffic.
 * 503 + status 'degraded' when the DB layer fails, so orchestrators can react.
 */
export async function GET() {
  const time = new Date().toISOString()
  try {
    const t0 = Date.now()
    const products = await db.product.count()
    const latencyMs = Date.now() - t0
    return NextResponse.json({
      status: 'ok',
      version: APP_VERSION,
      db: { ok: true, latencyMs, products },
      uptimeSec: Math.round((Date.now() - BOOT) / 1000),
      time,
    })
  } catch (err) {
    console.error('[health] db check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'degraded', db: { ok: false }, time }, { status: 503 })
  }
}
