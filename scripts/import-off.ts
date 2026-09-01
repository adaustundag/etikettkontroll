/**
 * Local Open Food Facts import runner.
 * Usage: DATABASE_URL=file:./db/custom.db bun scripts/import-off.ts [startPage] [pages] [--no-images]
 */
import { importOffPages } from '../src/lib/off-import'

const args = process.argv.slice(2)
const startPage = Number(args[0]) || 1
const pages = Number(args[1]) || 1
const withImages = !args.includes('--no-images')

const summary = await importOffPages({ startPage, pages, withImages })
console.log(JSON.stringify(summary, null, 2))
process.exit(0)
