/**
 * Task 30D regression — registration confirmation email escaping.
 *
 * The display name is stored literally (React escapes it in the UI), but the
 * EMAIL body must contain it entity-escaped: a name like
 * `<a href="http://evil">x</a>` may never ship as a live link from our
 * domain. The mail transport is stubbed at the fetch boundary (Resend API),
 * and the fire-and-forget send is awaited with a bounded poll — no sleeps
 * without assertions.
 */
import '../setup'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { POST as registerPOST } from '@/app/api/auth/register/route'
import { req } from '../setup'
import { wipeDb } from '../fixtures'

const NAME = '<a href="http://evil">Phishy</a>'

let captured: Array<{ to: string; subject: string; html: string }> = []
let realFetch: typeof globalThis.fetch

beforeEach(async () => {
  await wipeDb()
  captured = []
  realFetch = globalThis.fetch
  // Stub ONLY the Resend API call; everything else fetches as usual.
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (typeof url === 'string' && url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse((init as { body: string }).body) as { to: string; subject: string; html: string }
      captured.push(body)
      return new Response(JSON.stringify({ id: 'test-mail' }), { status: 200 })
    }
    return realFetch(input as never, init as never)
  }) as typeof fetch
  process.env.RESEND_API_KEY = 'test-key'
})

afterEach(async () => {
  globalThis.fetch = realFetch
  delete process.env.RESEND_API_KEY
})

/** Poll until the fire-and-forget mail lands or the budget expires. */
async function waitForMail(timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (captured.length === 0 && Date.now() - start < timeoutMs) {
    await Bun.sleep(25)
  }
}

describe('registration confirmation email — HTML injection closed', () => {
  test('HTML-like name stored literally, escaped once in the email', async () => {
    const res = await registerPOST(
      req('POST', '/api/auth/register', { name: NAME, email: 'phish@test.se', password: 'supersecret1' }),
    )
    expect(res.status).toBe(200)

    // Account data is the literal string (React renders it safely as text).
    const stored = await db.user.findUnique({ where: { email: 'phish@test.se' }, select: { name: true } })
    expect(stored?.name).toBe(NAME)

    await waitForMail()
    expect(captured.length).toBe(1)
    expect(captured[0].to).toBe('phish@test.se')
    // The email body contains the ESCAPED name — no live <a> element ships.
    expect(captured[0].html).toContain('&lt;a href=&quot;http://evil&quot;&gt;Phishy&lt;/a&gt;')
    expect(captured[0].html).not.toContain('<a href="http://evil">')
  })

  test('Swedish display name round-trips into the email', async () => {
    const res = await registerPOST(
      req('POST', '/api/auth/register', { name: 'Pär Åhlén', email: 'par@test.se', password: 'supersecret1' }),
    )
    expect(res.status).toBe(200)
    await waitForMail()
    expect(captured[0].html).toContain('Pär Åhlén')
  })
})
