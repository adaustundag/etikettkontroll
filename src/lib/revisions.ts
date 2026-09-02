import { db } from '@/lib/db'
import { computeTrust, requiredApprovalsFor, type TrustLevel } from '@/lib/trust'
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

/** Fields where a single-field correction auto-publishes for any trust level. */
const LOW_RISK_FIELDS: LabelField[] = ['servingSize', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']

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

/** Mark a revision approved, supersede the previous approved one, sync product denormalized fields. */
export async function publishRevision(tx: Prisma.TransactionClient, revisionId: string) {
  const revision = await tx.productRevision.update({
    where: { id: revisionId },
    data: { status: 'approved', finalizedAt: new Date() },
  })
  await tx.productRevision.updateMany({
    where: { productId: revision.productId, status: { in: ['approved', 'auto_approved'] }, id: { not: revisionId } },
    data: { status: 'superseded' },
  })
  await tx.product.update({
    where: { id: revision.productId },
    data: { name: revision.name, brand: revision.brand },
  })
  return revision
}

async function awardKarma(
  tx: Prisma.TransactionClient,
  userId: string,
  delta: number,
  reason: string,
  refId: string,
) {
  await tx.user.update({
    where: { id: userId },
    data: { karma: { increment: delta } },
  })
  await tx.karmaEvent.create({ data: { userId, delta, reason, refId } })
}

/**
 * Option B submission flow:
 *  - L2+ : auto-publish
 *  - L1  : auto-publish single-field corrections, otherwise 1 approval needed
 *  - L0  : 2 approvals needed
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

  const trust = await computeTrust(user.id)
  const product = await db.product.findUnique({ where: { barcode } })

  // For edits: diff against the currently approved revision.
  let changedFields: LabelField[] = [...LABEL_FIELDS]
  if (product) {
    const currentApproved = await db.productRevision.findFirst({
      where: { productId: product.id, status: 'approved' },
      orderBy: { version: 'desc' },
    })
    changedFields = computeChangedFields(values, currentApproved ? revisionValues(currentApproved) : null)
    if (changedFields.length === 0) {
      throw new SubmitError('No changes compared to the current approved version.')
    }
  }

  let status: RevisionStatus = 'pending'
  let requiredApprovals = requiredApprovalsFor(trust.level)
  let autoNote: string | null = null
  if (trust.level >= 2) {
    status = 'auto_approved'
    requiredApprovals = 0
    autoNote = `Auto-published: ${trust.label} contributor`
  } else if (trust.level === 1 && changedFields.length <= 1) {
    status = 'auto_approved'
    requiredApprovals = 0
    autoNote = 'Auto-published: single-field correction by a Contributor'
  } else if (
    changedFields.length <= 1 &&
    // Bootstrap deadlock relief: single nutrition-field corrections are
    // low-risk (bounded numbers, fully diffable, revertible) and auto-publish
    // for everyone. Free-text fields (name/brand/ingredients/photos) still
    // require review — they are the spam vectors.
    changedFields.every((f) => LOW_RISK_FIELDS.includes(f))
  ) {
    status = 'auto_approved'
    requiredApprovals = 0
    autoNote = 'Auto-published: single nutrition-field correction'
  }

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
        autoNote,
        finalizedAt: status === 'pending' ? null : new Date(),
      },
    })

    if (status === 'auto_approved') {
      await tx.productRevision.updateMany({
        where: { productId, status: { in: ['approved', 'auto_approved'] }, id: { not: revision.id } },
        data: { status: 'superseded' },
      })
      await tx.product.update({ where: { id: productId }, data: { name: values.name, brand: values.brand } })
      await awardKarma(tx, user.id, 2, 'revision_approved', revision.id)
    }

    return revision
  })

  return {
    revisionId: result.id,
    productId: result.productId,
    barcode,
    version: result.version,
    status: status === 'auto_approved' ? 'auto_approved' : 'pending',
    autoNote,
    requiredApprovals,
  }
}

export type RevisionWithRelations = ProductRevision & {
  submittedBy: { id: string; name: string; karma: number; trustLevel?: number }
  reviews: (ReviewWithReviewer)[]
  product?: { barcode: string } | null
}

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
  }
}

export const revisionInclude = {
  product: { select: { barcode: true } },
  submittedBy: { select: { id: true, name: true, karma: true, trustLevel: true } },
  reviews: {
    include: { reviewer: { select: { id: true, name: true, karma: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ProductRevisionInclude

export type { TrustLevel }
