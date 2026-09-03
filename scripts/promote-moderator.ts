/**
 * Operator command: grant or revoke moderator/admin authority explicitly.
 * Authority is stored in User.role, independent of earned karma/trustLevel.
 *
 * Usage:
 *   bun scripts/promote-moderator.ts <email>            # grant moderator
 *   bun scripts/promote-moderator.ts <email> --admin    # grant admin
 *   bun scripts/promote-moderator.ts <email> --revoke   # back to plain user
 */
import { PrismaClient } from '@prisma/client'

const email = process.argv[2]?.trim().toLowerCase()
const revoke = process.argv.includes('--revoke')
const admin = process.argv.includes('--admin')

if (!email) {
  console.error('Usage: bun scripts/promote-moderator.ts <email> [--admin] [--revoke]')
  process.exit(1)
}

const db = new PrismaClient()
const user = await db.user.findUnique({ where: { email } })
if (!user) {
  console.error(`No account found for ${email}`)
  process.exit(1)
}
if (user.disabledAt) {
  console.error('Refusing to change role: this account is disabled.')
  process.exit(1)
}

const nextRole = revoke ? 'user' : admin ? 'admin' : 'moderator'
await db.user.update({ where: { id: user.id }, data: { role: nextRole } })
// Cached trust badge follows the explicit appointment so review-queue UI
// affordances appear; earned reputation (karma) is left untouched.
if (!revoke) await db.user.update({ where: { id: user.id }, data: { trustLevel: admin ? 3 : 3 } })

console.log(`${email}: role ${user.role} -> ${nextRole} (karma unchanged: ${user.karma})`)
await db.$disconnect()
