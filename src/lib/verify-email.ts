import { db } from '@/lib/db'

/**
 * Derived email verification — no schema column needed. An email counts as
 * verified when its ownership was proven through a channel that checks it:
 * - an external identity (Google/Facebook verify the address), or
 * - a magic-link sign-in completed for that address (usedAt set).
 * Password registration alone proves nothing and leaves the flag false.
 */
export async function emailVerifiedFor(user: { id: string; email: string }): Promise<boolean> {
  try {
    const [identity, usedToken] = await Promise.all([
      db.externalIdentity.findFirst({ where: { userId: user.id }, select: { id: true } }),
      // Magic links are requested with a lowercased email, but the account
      // may hold any casing — compare the common variants.
      db.magicToken.findFirst({
        where: { email: { in: [user.email, user.email.toLowerCase(), user.email.toUpperCase()] }, usedAt: { not: null } },
        select: { id: true },
      }),
    ])
    return Boolean(identity ?? usedToken)
  } catch {
    return false
  }
}
