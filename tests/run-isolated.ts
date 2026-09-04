/**
 * Isolated test runner (Task 30A).
 *
 * Creates a unique disposable SQLite database and uploads directory for this
 * run, exports TEST_DATABASE_URL / UPLOADS_DIR for tests/setup.ts, runs
 * `bun test`, then deletes only files this run created.
 *
 * Guards: refuses inherited DATABASE_URL targets (anything not inside the OS
 * temp dir), so a misconfigured environment can never point the suite at the
 * dev DB. All destructive operations are scoped to the temp dir created here.
 */
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'ek-test-'))
const dbPath = path.join(tmpRoot, 'test.db')
const uploadsDir = path.join(tmpRoot, 'uploads')
const dbUrl = `file:${dbPath}`

// Guard: every path this run will create or delete must live in the temp dir.
const tmpReal = path.resolve(tmpRoot)
for (const p of [dbPath, uploadsDir]) {
  if (!path.resolve(p).startsWith(tmpReal)) {
    console.error('refusing to run: test path escapes the disposable temp dir')
    process.exit(1)
  }
}
// Guard: an inherited DATABASE_URL pointing outside tmpdir is refused. The
// suite must never inherit the dev DB silently.
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('ek-test-')) {
  console.error(`refusing inherited DATABASE_URL: ${process.env.DATABASE_URL}`)
  process.exit(1)
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) {
    rmSync(tmpRoot, { recursive: true, force: true })
    process.exit(res.status ?? 1)
  }
  return res
}

// 1. Schema push into the isolated DB.
run('bun', ['x', 'prisma', 'db', 'push', '--skip-generate'], {
  ...process.env,
  DATABASE_URL: dbUrl,
})

// 2. Run the suite against the isolated DB + uploads dir.
const test = run('bun', ['test'], {
  ...process.env,
  DATABASE_URL: dbUrl,
  TEST_DATABASE_URL: dbUrl,
  UPLOADS_DIR: uploadsDir,
  NODE_ENV: 'test',
})

// 3. Cleanup only this run's files.
rmSync(tmpRoot, { recursive: true, force: true })
process.exit(test.status ?? 1)
