import { NextResponse } from 'next/server'
import { OAUTH_PROVIDERS, providerConfigured } from '@/lib/oauth'

export const dynamic = 'force-dynamic'

/** Which sign-in methods the server can actually serve (UI degrades gracefully). */
export async function GET() {
  return NextResponse.json({
    google: providerConfigured('google'),
    facebook: providerConfigured('facebook'),
    // magic links always "work"; without RESEND_API_KEY they run in dev mode
    magic: true,
  })
}
