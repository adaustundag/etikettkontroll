// Build orchestrator (cross-platform): next build, then copy standalone assets.
// Replaces shell `&&` chaining, which broke under bun's Windows shell.
const { spawnSync } = require('child_process')

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('bun', ['x', 'next', 'build'])
run('bun', ['scripts/copy-standalone.cjs'])
console.log('build complete')
