import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'

// Legacy schema = schema at HEAD (pre launch-readiness additions).
const legacy = execSync('git show HEAD:prisma/schema.prisma', { encoding: 'utf8', maxBuffer: 1e8 })
writeFileSync('prisma/schema.legacy.prisma', legacy, 'utf8')

const run = (cmd: string) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8 })

mkdirSync('prisma/migrations/0001_baseline', { recursive: true })
mkdirSync('prisma/migrations/0002_launch_readiness', { recursive: true })

const baseline = run(
  'bun x prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.legacy.prisma --script',
)
writeFileSync('prisma/migrations/0001_baseline/migration.sql', baseline, 'utf8')

const additive = run(
  'bun x prisma migrate diff --from-schema-datamodel prisma/schema.legacy.prisma --to-schema-datamodel prisma/schema.prisma --script',
)
writeFileSync('prisma/migrations/0002_launch_readiness/migration.sql', additive, 'utf8')

rmSync('prisma/schema.legacy.prisma')
console.log('baseline bytes:', baseline.length, '| additive bytes:', additive.length)
