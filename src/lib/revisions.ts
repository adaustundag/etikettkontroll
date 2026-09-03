import { db } from '@/lib/db'
import { computeTrust, requiredApprovalsFor, type TrustLevel } from '@/lib/trust'
import { existsSync } from 'fs'
import path from 'path'
import { uploadsDir } from '@/lib/uploads'
import {
  LABEL_FIELDS,
  NUMERIC_FIELDS,
  type LabelField,
  type LabelValues,
  type PublicUser,
  type RevisionDTO,
  type RevisionStatus,
  type SubmitPayload,
  type SubmitResult,
} from '@/lib/types'
import { Prisma, type ProductRevision } from '@prisma/client'

export class SubmitError extends Error {}

/** Submitted against a revision that is no longer the canonical current publication. */
export class SubmitConflict extends Error {
  constructor(readonly currentRevisionId: string | null) {
    super('This product changed while you were editing. Please review the current version and resubmit.')
  }
}

/** Fields where a single-field correction auto-publishes for any trust level. */
const LOW_RISK_FIELDS: LabelField[] = ['servingSize', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']
void LOW_RISK_FIELDS // removed with the T3 bypass cleanup (kept reference-free)

/** Fields whose verification requires the ingredient-list photo as evidence. */
const INGREDIENT_CLAIM_FIELDS: LabelField[] = ['ingredients', 'ingredientsImage']
/** Fields whose verification requires the nutrition-table photo as evidence. */
const NUTRITION_CLAIM_FIELDS: LabelField[] = ['servingSize', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']
/** Identity/photo claims require the front-of-pack photo. */
const FRONT_CLAIM_FIELDS: LabelField[] = ['name', 'brand', 'frontImage']

/** An /uploads/ reference is only evidence if the file actually exists on disk. */
export function evidenceFileExists(ref: string | null | undefined): boolean {
  if (!ref || !ref.startsWith('/uploads/')) return false
  const safe = path.basename(ref)
  return existsSync(path.join(uploadsDir(), safe))
}

export type EvidenceCoverage = {
  ingredients: boolean
  nutrition: boolean
  front: boolean
}

/** Which claim groups of a revision are backed by existing, usable evidence files. */
export function evidenceCoverage(r: {
  frontImage: string | null
  ingredientsImage: string | null
  nutritionImage: string | null
}): EvidenceCoverage {
  return {
    ingredients: evidenceFileExists(r.ingredientsImage),
    nutrition: evidenceFileExists(r.nutritionImage),
    front: evidenceFileExists(r.frontImage),
  }
}

/**
 * Verification state, derived — never from autoNote text.
 *  verified  : a review-based verification finalized (survives superseding)
 *  rejected  : finalized as rejected
 *  disputed  : approvals and rejections coexist; blocked until resolved
 *  pending   : awaiting review
 *  unverified: published/legacy without review-based verification (imports, legacy)
 */
export function verificationState(r: {
  status: string
  verifiedAt: Date | string | null
  disputeStatus: string | null
}): 'verified' | 'rejected' | 'disputed' | 'pending' | 'unverified' {
  if (r.verifiedAt) return 'verified'
  if (r.status === 'rejected') return 'rejected'
  if (r.disputeStatus === 'disputed') return 'disputed'
  if (r.status === 'pending') return 'pending'
  return 'unverified'
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function extractLabelValues(payload: SubmitPayload): LabelValues {
  return {
    name: (payload.name || '').trim(),
    brand: (payload.brand || '').trim(),
    ingredients: (payload.ingredients || '').trim(),
    servingSize: (payload.servingSize || '').trim() || null,
    calories: toNum(payload.calories),
    protein: toNum(payload.protein),
    carbs: toNum(payload.carbs),
    sugars: toNum(payload.sugars),
    fat: toNum(payload.fat),
    salt: toNum(payload.salt),
    frontImage: payload.frontImage || null,
    ingredientsImage: payload.ingredientsImage || null,
    nutritionImage: payload.nutritionImage || null,
  }
}

export function computeChangedFields(next: LabelValues, prev: LabelValues | null): LabelField[] {
  if (!prev) return [...LABEL_FIELDS]
  return LABEL_FIELDS.filter((f) => {
    const a = next[f]
    const b = prev[f]
    if (NUMERIC_FIELDS.includes(f)) return toNum(a) !== toNum(b)
    return (a ?? null) !== (b ?? null)
  })
}

export function revisionValues(r: ProductRevision): LabelValues {
  return {
    name: r.name,
    brand: r.brand,
    ingredients: r.ingredients,
    servingSize: r.servingSize,
    calories: r.calories,
    protein: r.protein,
    carbs: r.carbs,
    sugars: r.sugars,
    fat: r.fat,
    salt: r.salt,
    frontImage: r.frontImage,
    ingredientsImage: r.ingredientsImage,
    nutritionImage: r.nutritionImage,
  }
}

/** Canonical current-publication lookup for a product (pointer first, legacy fallback). */
export async function currentPublicationFor(
  client: Prisma.TransactionClient | typeof db,
  productId: string,
): Promise<ProductRevision | null> {
  const product = await client.product.findUnique({ where: { id: productId }, select: { currentRevisionId: true } })
  if (product?.currentRevisionId) {
    const ptr = await client.productRevision.findFirst({
      where: { id: product.currentRevisionId, productId, status: { in: ['approved', 'auto_approved'] } },
    })
    if (ptr) return ptr
  }
  // Legacy fallback (pre-pointer rows, pre-migration data).
  return client.productRevision.findFirst({
    where: { productId, status: { in: ['approved', 'auto_approved'] } },
    orderBy: { version: 'desc' },
  })
}

/**
 * THE single publication service. Every verified publication path — review
 * approval and moderator dispute resolution — must finalize through this
 * transactional helper. It:
 *   1. verifies the revision is pending (idempotent no-op if already current),
 *   2. stamps verifiedAt (review-based verification, survives superseding),
 *   3. supersedes the previous publication WITHOUT touching its verifiedAt —
 *      earlier verification history is preserved,
 *   4. moves the canonical Product.currentRevisionId pointer and denormalized
 *      search fields atomically.
 * Karma is awarded by the caller via awardKarma (idempotent, event-checked).
 */
export async function finalizePublication(tx: Prisma.TransactionClient, revisionId: string): Promise<ProductRevision> {
  const existing = await tx.productRevision.findUnique({ where: { id: revisionId } })
  if (!existing) throw new SubmitError('Revision not found.')
  const product = await tx.product.findUnique({ where: { id: existing.productId }, select: { currentRevisionId: true } })
  if (existing.status === 'approved' && product?.currentRevisionId === existing.id) {
    return existing // already the current publication — retry is a no-op
  }
  if (existing.status !== 'pending') {
    throw new SubmitError('Revision is not in a publishable state.')
  }

  const revision = await tx.productRevision.update({
    where: { id: revisionId },
    data: { status: 'approved', verifiedAt: new Date(), finalizedAt: new Date() },
  })
  await tx.productRevision.updateMany({
    where: { productId: revision.productId, status: { in: ['approved', 'auto_approved'] }, id: { not: revisionId } },
    data: { status: 'superseded' },
  })
  await tx.product.update({
    where: { id: revision.productId },
    data: { name: revision.name, brand: revision.brand, currentRevisionId: revision.id },
  })
  return revision
}

/** Idempotent karma award — retries can never double-award. */
async function awardKarma(tx: Prisma.TransactionClient, userId: string, delta: number, reason: string, refId: string) {
  const already = await tx.karmaEvent.findFirst({ where: { userId, reason, refId }, select: { id: true } })
  if (already) return
  await tx.user.update({
    where: { id: userId },
    data: { karma: { increment: delta } },
  })
  await tx.karmaEvent.create({ data: { userId, delta, reason, refId } })
}

/**
 * Submission flow (launch-readiness T3/T4):
 *  - every submission is PENDING — there are no auto-publication bypasses for
 *    label facts (reputation may prioritize review, never substitute for it),
 *  - the diff baseline is the canonical current publication,
 *  - an explicit baseRevisionId is stamped; a mismatch with the canonical
 *    pointer raises SubmitConflict (409) instead of silently overwriting.
 */
export async function submitRevision(user: { id: string; name: string }, payload: SubmitPayload): Promise<SubmitResult> {
  const barcode = (payload.barcode || '').replace(/\s+/g, '')
  if (!/^\d{8,14}$/.test(barcode)) {
    throw new SubmitError('Barcode must be 8–14 digits (EAN-13 is standard on groceries).')
  }
  const values = extractLabelValues(payload)
  if (values.name.length < 2 || values.name.length > 200) {
    throw new SubmitError('Product name must be 2–200 characters.')
  }
  if (values.brand.length < 1 || values.brand.length > 120) {
    throw new SubmitError('Brand must be 1–120 characters.')
  }
  if (values.ingredients.length < 5 || values.ingredients.length > 8000) {
    throw new SubmitError(
      'The ingredient list is required (5–8000 characters) — that is the heart of this database.',
    )
  }
  if (values.servingSize && values.servingSize.length > 60) {
    throw new SubmitError('Serving size is too long (max 60 characters).')
  }
  for (const n of [values.calories, values.protein, values.carbs, values.sugars, values.fat, values.salt]) {
    if (n !== null && (n < 0 || n > 10000)) {
      throw new SubmitError('Nutrition values must be numbers between 0 and 10000.')
    }
  }
  // Photo fields are filled by /api/upload, which returns /uploads/<name> —
  // anything else (data URLs, remote hosts, traversal) is rejected here.
  for (const img of [values.frontImage, values.ingredientsImage, values.nutritionImage]) {
    if (img && !/^\/uploads\/[a-z0-9-]+\.(jpe?g|png|webp)$/.test(img)) {
      throw new SubmitError('Label photos must be uploaded through the app first.')
    }
  }
  if (payload.baseRevisionId !== undefined && payload.baseRevisionId !== null && !/^[a-z0-9]{20,40}$/i.test(payload.baseRevisionId)) {
    throw new SubmitError('baseRevisionId is malformed.')
  }

  await computeTrust(user.id) // keeps the cached trust badge fresh for the queue UI
  const product = await db.product.findUnique({ where: { barcode } })
  if (product?.quarantined) {
    throw new SubmitError('This record is quarantined and cannot be edited until an operator promotes it.')
  }

  // Baseline: the canonical current publication (pointer first, legacy fallback).
  let base: ProductRevision | null = null
  let changedFields: LabelField[] = [...LABEL_FIELDS]
  if (product) {
    base = await currentPublicationFor(db, product.id)
    changedFields = computeChangedFields(values, base ? revisionValues(base) : null)
    if (changedFields.length === 0) {
      throw new SubmitError('No changes compared to the current published version.')
    }
    // Optimistic concurrency: stale edits must not overwrite newer data.
    const canonicalId = base?.id ?? null
    const claimed = payload.baseRevisionId?.trim() || null
    if (canonicalId && claimed !== canonicalId) {
      throw new SubmitConflict(canonicalId)
    }
  }
  const baseRevisionId = product ? (base?.id ?? null) : null

  // No bypasses: every submission enters review (level only sets the count).
  const status: RevisionStatus = 'pending'
  const requiredApprovals = requiredApprovalsFor((await computeTrust(user.id)).level)

  const result = await db.$transaction(async (tx) => {
    let productId: string
    let version: number
    if (product) {
      productId = product.id
      const last = await tx.productRevision.findFirst({
        where: { productId: product.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      version = (last?.version ?? 0) + 1
    } else {
      const created = await tx.product.create({
        data: { barcode, name: values.name, brand: values.brand },
      })
      productId = created.id
      version = 1
    }

    const revision = await tx.productRevision.create({
      data: {
        productId,
        version,
        submittedById: user.id,
        ...values,
        status,
        requiredApprovals,
        changedFields: JSON.stringify(changedFields),
        baseRevisionId,
        finalizedAt: null,
      },
    })

    return revision
  })

  return {
    revisionId: result.id,
    productId: result.productId,
    barcode,
    version: result.version,
    status: 'pending',
    autoNote: null,
    requiredApprovals,
  }
}

export const revisionInclude = {
  product: { select: { barcode: true, quarantined: true } },
  submittedBy: { select: { id: true, name: true, karma: true, trustLevel: true } },
  reviews: {
    include: { reviewer: { select: { id: true, name: true, karma: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ProductRevisionInclude

export type RevisionWithRelations = Prisma.ProductRevisionGetPayload<{ include: typeof revisionInclude }>

export type ReviewWithReviewer = {
  id: string
  verdict: string
  comment: string | null
  createdAt: Date
  reviewer: { id: string; name: string; karma: number; trustLevel?: number }
}

export function mapUser(u: { id: string; name: string; karma: number; trustLevel?: number }): PublicUser {
  const labels = ['Newcomer', 'Contributor', 'Trusted', 'Moderator']
  const level = Math.min(3, Math.max(0, u.trustLevel ?? 0))
  return { id: u.id, name: u.name, karma: u.karma, trustLevel: level, trustLabel: labels[level] }
}

export function mapRevision(r: RevisionWithRelations): RevisionDTO {
  let changedFields: string[] = []
  try {
    changedFields = JSON.parse(r.changedFields) as string[]
  } catch {
    changedFields = []
  }
  return {
    id: r.id,
    productId: r.productId,
    barcode: r.product?.barcode ?? '',
    version: r.version,
    status: r.status as RevisionStatus,
    name: r.name,
    brand: r.brand,
    ingredients: r.ingredients,
    servingSize: r.servingSize,
    calories: r.calories,
    protein: r.protein,
    carbs: r.carbs,
    sugars: r.sugars,
    fat: r.fat,
    salt: r.salt,
    frontImage: r.frontImage,
    ingredientsImage: r.ingredientsImage,
    nutritionImage: r.nutritionImage,
    requiredApprovals: r.requiredApprovals,
    approvedCount: r.approvedCount,
    rejectedCount: r.rejectedCount,
    changedFields,
    autoNote: r.autoNote,
    createdAt: r.createdAt.toISOString(),
    finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
    submittedBy: mapUser(r.submittedBy),
    reviews: r.reviews.map((rev) => ({
      id: rev.id,
      verdict: rev.verdict as 'approve' | 'reject',
      comment: rev.comment,
      createdAt: rev.createdAt.toISOString(),
      reviewer: mapUser(rev.reviewer),
    })),
    // structured provenance + verification (T2/T7) — autoNote is legacy text only
    sourceType: (r.sourceType as RevisionDTO['sourceType']) ?? 'human',
    sourceUrl: r.sourceUrl,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    nutritionBasis: (r.nutritionBasis as RevisionDTO['nutritionBasis']) ?? null,
    baseRevisionId: r.baseRevisionId,
    disputeStatus: r.disputeStatus,
    disputeReason: r.disputeReason,
    verificationState: verificationState(r),
  }
}

export type { TrustLevel }
