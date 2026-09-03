/**
 * Operator command: launch-readiness backfill (dry-run first).
 *
 *   DATABASE_URL=<target> bun scripts/migrate-launch.ts           # DRY RUN (default)
 *   DATABASE_URL=<target> bun scripts/migrate-launch.ts --apply   # write changes
 *
 * The same backfill runs automatically (apply=true) at server boot, so this
 * script exists for auditing and manual execution against any environment.
 * Idempotent — running it repeatedly produces no additional changes.
 */
import { runLaunchBackfill } from '../src/lib/launch-backfill'

const apply = process.argv.includes('--apply')
const summary = await runLaunchBackfill(apply)

const mode = apply ? 'APPLY' : 'DRY RUN'
console.log(`Launch-readiness backfill — mode: ${mode}`)
console.log(`products scanned:            ${summary.products}`)
console.log(`revisions scanned:           ${summary.revisions}`)
console.log(`current pointers set:        ${summary.pointerFixes}`)
console.log(`classified demo:             ${summary.classifiedDemo}`)
console.log(`classified openfoodfacts:    ${summary.classifiedOff}`)
console.log(`classified unknown_legacy:   ${summary.classifiedLegacy}`)
console.log(`verification stamps granted: ${summary.verifiedCount} (requires human reviews + evidence)`)
console.log(`quarantine candidates (manual decision, not applied): ${summary.quarantineCandidates}`)
if (!apply) console.log('\nDry run only — re-run with --apply to write the changes above.')
process.exit(0)
