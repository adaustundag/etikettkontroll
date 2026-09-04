/**
 * Task 30D regression tests — origin trust boundary.
 *
 * publicOrigin() must fail closed in production (no APP_URL / invalid APP_URL
 * / forged forwarded headers) and keep dev/test workable. Unit-level: the
 * function is exercised directly with crafted requests; NODE_ENV is flipped
 * per test since the harness runs as test.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { publicOrigin, validatePublicOrigin } from '@/lib/mail'

const BASE = 'http://localhost:3000'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest(BASE + '/api/auth/magic/request', { headers })
}

const ENV_KEYS = ['APP_URL', 'NEXT_PUBLIC_SITE_URL'] as const
const env = process.env as Record<string, string | undefined>
function withEnv(mutate: () => void): () => void {
  const before = [...ENV_KEYS, 'NODE_ENV'].map((k) => [k, env[k]] as const)
  mutate()
  return () => {
    for (const [k, v] of before) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
}

afterEach(() => {
  delete process.env.EK_TEST_PROD
})

describe('validatePublicOrigin', () => {
  test('accepts plain https origins (with or without trailing slash)', () => {
    expect(validatePublicOrigin('https://etikettkontroll.se')).toBe('https://etikettkontroll.se')
    expect(validatePublicOrigin('https://ek.up.railway.app/')).toBe('https://ek.up.railway.app')
  })

  test('rejects non-https, credentials, query, fragment, paths, odd ports, garbage', () => {
    expect(validatePublicOrigin('http://etikettkontroll.se')).toBeNull()
    expect(validatePublicOrigin('https://user:pass@evil.se')).toBeNull()
    expect(validatePublicOrigin('https://evil.se/?x=1')).toBeNull()
    expect(validatePublicOrigin('https://evil.se/#frag')).toBeNull()
    expect(validatePublicOrigin('https://evil.se/app')).toBeNull()
    expect(validatePublicOrigin('https://evil.se:8443')).toBeNull()
    expect(validatePublicOrigin('not a url')).toBeNull()
  })
})

describe('publicOrigin — production fail-closed', () => {
  test('production: missing APP_URL throws (forwarded headers are never trusted)', () => {
    const restore = withEnv(() => {
      delete env.APP_URL
      delete env.NEXT_PUBLIC_SITE_URL
      env.NODE_ENV = 'production'
    })
    try {
      const req = reqWithHeaders({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.invalid',
      })
      expect(() => publicOrigin(req)).toThrow(/APP_URL/)
    } finally {
      restore()
      env.NODE_ENV = 'test'
    }
  })

  test('production: invalid APP_URL throws', () => {
    const restore = withEnv(() => {
      env.APP_URL = 'https://user:pass@evil.se/path'
      env.NODE_ENV = 'production'
    })
    try {
      expect(() => publicOrigin(reqWithHeaders({}))).toThrow(/APP_URL/)
    } finally {
      restore()
      env.NODE_ENV = 'test'
    }
  })

  test('production: valid APP_URL wins over forged forwarded headers', () => {
    const restore = withEnv(() => {
      env.APP_URL = 'https://etikettkontroll.se'
      env.NODE_ENV = 'production'
    })
    try {
      const req = reqWithHeaders({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.invalid',
      })
      expect(publicOrigin(req)).toBe('https://etikettkontroll.se')
    } finally {
      restore()
      env.NODE_ENV = 'test'
    }
  })

  test('dev/test: forwarded headers still work (sandbox/preview contract)', () => {
    const restore = withEnv(() => {
      delete env.APP_URL
      delete env.NEXT_PUBLIC_SITE_URL
      env.NODE_ENV = 'development'
    })
    try {
      const req = reqWithHeaders({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'preview.example.internal',
      })
      expect(publicOrigin(req)).toBe('https://preview.example.internal')
    } finally {
      restore()
    }
  })
})
