/**
 * Demo-data quarantine (EK-01): the reversible cleanup for records whose
 * provenance is demo/test rather than genuine contribution.
 *
 * Classification rule (evidence-based, not name-based):
 *   A product is quarantined when its CANONICAL CURRENT PUBLICATION revision
 *   was submitted by a demo identity (sourceType === 'demo', stamped by the
 *   launch backfill from the submitter's @etikettkontroll.se email — never
 *   inferred from the product name or barcode).
 *
 * Mixed records: if the current publication is human/OFF-imported, older
 * demo-authored revisions in its history do NOT quarantine the product —
 * nothing publicly visible claims demo data.
 *
 * Reversibility & repeatability:
 *   - Quarantine only SETS the existing Product.quarantined flag; no rows are
 *     deleted, no revision data is rewritten.
 *   - Only products that are not already quarantined are evaluated, so
 *     re-running produces zero additional changes.
 *   - Un-quarantining is an explicit operator decision (db update), never
 *     something this module does.
 */
import { db } from '@/lib/db'

export type QuarantineCandidate = {
  productId: string
  barcode: string
  name: string
  reason: string
}

export type QuarantineSummary = {
  scanned: number
  alreadyQuarantined: number
  quarantined: number
  candidates: QuarantineCandidate[]
  dryRun: boolean
}

export async function quarantineDemoRecords(apply: boolean): Promise<QuarantineSummary> {
  const products = await db.product.findMany({
    where: { quarantined: false },
    select: {
      id: true,
      barcode: true,
      name: true,
      currentRevisionId: true,
      revisions: {
        where: { id: { not: undefined } },
        select: { id: true, sourceType: true, status: true, version: true },
        orderBy: { version: 'desc' },
      },
    },
  })

  const candidates: QuarantineCandidate[] = []
  for (const p of products) {
    // The record the public actually sees: the canonical current publication.
    const current =
      (p.currentRevisionId ? p.revisions.find((r) => r.id === p.currentRevisionId) : undefined) ??
      p.revisions.find((r) => ['approved', 'auto_approved'].includes(r.status))
    if (!current) continue // never published — already invisible everywhere
    if (current.sourceType !== 'demo') continue
    candidates.push({
      productId: p.id,
      barcode: p.barcode,
      name: p.name,
      reason: `current publication v${current.version} (${current.id}) has sourceType=demo`,
    })
  }

  if (apply) {
    for (const c of candidates) {
      await db.product.update({ where: { id: c.productId }, data: { quarantined: true } })
    }
  }

  const alreadyQuarantined = await db.product.count({ where: { quarantined: true } })
  return {
    scanned: products.length,
    alreadyQuarantined: apply ? alreadyQuarantined - candidates.length : alreadyQuarantined,
    quarantined: apply ? candidates.length : 0,
    candidates,
    dryRun: !apply,
  }
}
