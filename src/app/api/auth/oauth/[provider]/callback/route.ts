import { NextRequest, NextResponse } from 'next/server'
import {
  OAUTH_PROVIDERS,
  OAuthProvider,
  consumeState,
  exchangeCodeForProfile,
  finishSession,
  oauthErrorMessage,
  resolveOAuthUser,
} from '@/lib/oauth'
import { publicOrigin } from '@/lib/mail'

export const dynamic = 'force-dynamic'

// GET /api/auth/oauth/[provider]/callback?code&state — finish the flow
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
    return NextResponse.json({ error: 'Unknown sign-in provider.' }, { status: 404 })
  }
  const p = provider as OAuthProvider
  const url = req.nextUrl
  const errorParam = url.searchParams.get('error')
  if (errorParam) {
    // user cancelled at the consent screen
    return NextResponse.redirect(`${url.origin}/?oauth=cancelled`)
  }

  try {
    const state = await consumeState(p, url.searchParams.get('state'))
    if (!state) {
      return NextResponse.json({ error: 'Sign-in session expired. Please try again.' }, { status: 400 })
    }
    const code = url.searchParams.get('code')
    if (!code) return NextResponse.json({ error: 'Missing authorization code.' }, { status: 400 })

    const profile = await exchangeCodeForProfile(p, code, publicOrigin(req), state)
    const user = await resolveOAuthUser(p, profile.providerId, profile.email, profile.name)
    return finishSession(user.id, publicOrigin(req), state.p)
  } catch (err) {
    console.error(`oauth ${p} callback error`, err)
    return NextResponse.json({ error: oauthErrorMessage(err) }, { status: 400 })
  }
}
