// Canonical public origin of the site (server-side helpers only).
// APP_URL is the explicit override (recommended in production); the fallback
// is the known Railway domain so metadata/sitemaps stay valid even if the
// variable is missing.

/** Bumped alongside package.json when shipping. */
export const APP_VERSION = '0.2.1'

export function siteUrl(): string {
  const explicit = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  return 'https://etikettkontroll-production.up.railway.app'
}
