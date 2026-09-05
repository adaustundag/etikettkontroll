// Post-build copy for the standalone output (cross-platform; called by `bun run build`).
const fs = require('fs')

fs.cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
fs.cpSync('public', '.next/standalone/public', { recursive: true })
console.log('standalone assets copied')
