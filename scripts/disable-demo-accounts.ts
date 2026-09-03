/**
 * Operator command: disable demo accounts (dry-run first).
 *
 * Usage:
 *   DATABASE_URL=file:/data/db/custom.db bun scripts/disable-demo-accounts.ts           # dry run
 *   DATABASE_URL=file:/data/db/custom.db bun scripts/disable-demo-accounts.ts --apply   # real
 *
 * Identifies demo accounts by the seed email domain (@etikettkontroll.se) and
 * any user explicitly marked sourceType demo via their revisions. Disabling
 * sets disabledAt — authentication (password, magic link, OAuth and existing
 * session tokens) fails for these accounts; their historical contributions
 * and revisions are preserved untouched for later classification.
 */
import { PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')
const db = new PrismaClient()

const DEMO_DOMAIN = 'etikettkontroll.se'

const candidates = await db.user.findMany({
  where: {
    OR: [{ email: { endsWith: '@' + DEMO_DOMAIN } }, { email: { endsWith: '@' + DEMO_DOMAIN.toUpperCase() } }],
  },
  select: { id: true, email: true, name: true, disabledAt: true, trustLevel: true, _count: { select: { revisions: true, reviews: true } } },
  orderBy: { email: 'asc' },
})

console.log(`Demo-account scan (domain @${DEMO_DOMAIN}) — mode: ${apply ? 'APPLY' : 'DRY RUN'}`)
console.log(`Found ${candidates.length} candidate account(s):\n`)

let changed = 0
for (const u of candidates) {
  const state = u.disabledAt ? 'already disabled' : 'ACTIVE'
  console.log(`- ${u.email} (${u.name}) [${state}] trust=${u.trustLevel} revisions=${u._count.revisions} reviews=${u._count.reviews}`)
  if (apply && !u.disabledAt) {
    await db.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } })
    changed++
  }
}

if (apply) {
  console.log(`\nDisabled ${changed} account(s). Existing tokens/sessions for these accounts now fail authentication.`)
} else {
  console.log('\nDry run only — re-run with --apply to disable the accounts above.')
}
await db.$disconnect()
