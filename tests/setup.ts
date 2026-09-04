/**
 * EtikettKontroll API test harness.
 *
 * This file MUST be the first import in every test file:
 *   import '../setup'
 *
 * It does three things, in this order:
 *  1. Points Prisma at an isolated test database. The canonical entry is
 *     tests/run-isolated.ts, which creates a unique temp-dir DB per run and
 *     exports TEST_DATABASE_URL. When the suite is started directly (bun test
 *     without the runner), setup.ts creates that same kind of disposable DB
 *     itself so the suite can never silently use the dev/demo database.
 *  2. Refuses to run destructive operations against dev/prod-like paths.
 *  3. Replaces `next/headers` with an in-memory request context. Route
 *     handlers call cookies()/headers() which normally require a Next.js
 *     request scope — the mock lets us invoke the handlers directly under
 *     `bun test` and control auth (bearer header + cookie jar) per test.
 */
import { mock } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

// --- 1. isolated database ---------------------------------------------------
function resolveTestDbUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim()
  if (explicit) return explicit
  // Direct `bun test` (no runner): create a throwaway DB in the OS temp dir
  // and push the schema into it, so the suite never uses the dev/demo DB.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-test-'))
  return `file:${path.join(dir, 'test.db')}`
}
const testDbUrl = resolveTestDbUrl()
if (!testDbUrl.includes('ek-test-')) {
  throw new Error(`tests must use an ek-test-* database, got: ${testDbUrl}`)
}
// Solo mode needs the schema; the runner (TEST_DATABASE_URL set) already pushed.
if (!process.env.TEST_DATABASE_URL) {
  const pushed = spawnSync('bun', ['x', 'prisma', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  if (pushed.status !== 0) {
    throw new Error('solo test mode: prisma db push failed for the temporary database')
  }
}
process.env.DATABASE_URL = testDbUrl

// --- 2. controllable request context ----------------------------------------
type Ctx = { headers: Record<string, string>; cookies: Record<string, string> }
const state: Ctx = { headers: {}, cookies: {} }

mock.module('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => state.headers[name.toLowerCase()] ?? null,
  }),
  cookies: async () => ({
    get: (name: string) => (name in state.cookies ? { name, value: state.cookies[name] } : undefined),
    getAll: () => Object.entries(state.cookies).map(([name, value]) => ({ name, value })),
    has: (name: string) => name in state.cookies,
    // Accepts both set(name, value, opts) and set({ name, value, ... }).
    set: (...args: unknown[]) => {
      const first = args[0] as { name?: string; value?: string } | string
      if (typeof first === 'string') state.cookies[first] = (args[1] as string) ?? ''
      else if (first && typeof first.name === 'string') state.cookies[first.name] = first.value ?? ''
    },
    delete: (name: string) => {
      delete state.cookies[name]
    },
    clear: () => {
      for (const k of Object.keys(state.cookies)) delete state.cookies[k]
    },
  }),
}))

/** Prime the mocked request scope. Call before each handler invocation. */
export function mockAuth(authorization?: string | null, cookies?: Record<string, string>) {
  state.headers = authorization ? { authorization } : {}
  state.cookies = { ...(cookies ?? {}) }
}

/** Reset the request scope (use in beforeEach). */
export function clearCtx() {
  state.headers = {}
  state.cookies = {}
}

/** Read a cookie the handler "set" via the mocked cookie jar (e.g. OAuth state). */
export function peekCookie(name: string): string | undefined {
  return state.cookies[name]
}

/** Inject a cookie into the mocked jar (simulates what a browser would send). */
export function plantCookie(name: string, value: string) {
  state.cookies[name] = value
}

// --- request builder ----------------------------------------------------------
import { NextRequest } from 'next/server'

const BASE = 'http://localhost:3000'

/**
 * Build a NextRequest like the Next.js router would. Query strings are fine,
 * e.g. req('GET', '/api/products?q=oatly').
 */
export function req(method: string, url: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {}
  let init: RequestInit | undefined
  if (body instanceof FormData) {
    init = { method, body }
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init = { method, body: typeof body === 'string' ? body : JSON.stringify(body) }
  } else {
    init = { method }
  }
  return new NextRequest(BASE + url, init as unknown as ConstructorParameters<typeof NextRequest>[1])
}

/** Second argument for parameterized handlers: { params: Promise<…> }. */
export function withParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

// --- set-cookie helpers ---------------------------------------------------------

export function setCookiesOf(res: Response): string[] {
  const r = res as unknown as { headers: { getSetCookie?: () => string[] } }
  if (typeof r.headers.getSetCookie === 'function') return r.headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? raw.split(/,(?=[^;]+?=)/) : []
}

/** Parse the ek_session cookie (name/value + serialized options) from a response. */
export function sessionCookie(res: Response): { value: string; options: string } | null {
  const found = setCookiesOf(res).find((s) => s.startsWith('ek_session='))
  if (!found) return null
  const [pair, ...rest] = found.split(';')
  return { value: pair.slice('ek_session='.length), options: rest.map((s) => s.trim()).join('; ') }
}
