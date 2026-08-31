import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import {
  OAUTH_PROVIDERS,
  OAuthProvider,
  buildAuthorizeUrl,
  pkcePair,
  providerConfigured,
  providerLabel,
  saveState,
} from '@/lib/oauth'

export const dynamic = 'force-dynamic'

// GET /api/auth/oauth/[provider]/start?popup=1 — kick off the authorization flow
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
    return NextResponse.json({ error: 'Unknown sign-in provider.' }, { status: 404 })
  }
  const p = provider as OAuthProvider
  if (!providerConfigured(p)) {
    return NextResponse.json(
      { error: `${providerLabel(p)} sign-in is not configured on the server yet.` },
      { status: 400 },
    )
  }

  const { verifier, challenge } = pkcePair()
  const state = {
    s: randomBytes(16).toString('base64url'),
    v: verifier,
    p: req.nextUrl.searchParams.get('popup') === '1',
    ts: Date.now(),
  }
  await saveState(p, state)

  const origin = req.nextUrl.origin
  return NextResponse.redirect(buildAuthorizeUrl(p, origin, state))
}
