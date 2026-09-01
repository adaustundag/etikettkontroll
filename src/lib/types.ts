// Shared DTO types between API routes and the client.

export type RevisionStatus = 'pending' | 'approved' | 'auto_approved' | 'rejected' | 'superseded'

export type PublicUser = {
  id: string
  name: string
  karma: number
  trustLevel: number
  trustLabel: string
}

export type LabelValues = {
  name: string
  brand: string
  ingredients: string
  servingSize: string | null
  calories: number | null
  protein: number | null
  carbs: number | null
  sugars: number | null
  fat: number | null
  salt: number | null
  frontImage: string | null
  ingredientsImage: string | null
  nutritionImage: string | null
}

export type ReviewDTO = {
  id: string
  verdict: 'approve' | 'reject'
  comment: string | null
  createdAt: string
  reviewer: PublicUser
}

export type RevisionDTO = LabelValues & {
  id: string
  productId: string
  /** Barcode of the parent product — canonical key for routing to the product page. */
  barcode: string
  version: number
  status: RevisionStatus
  requiredApprovals: number
  approvedCount: number
  rejectedCount: number
  changedFields: string[]
  autoNote: string | null
  createdAt: string
  finalizedAt: string | null
  submittedBy: PublicUser
  reviews: ReviewDTO[]
  /** Only present on queue items: current approved values to diff against. */
  current?: LabelValues | null
}

export type CommentDTO = {
  id: string
  body: string
  createdAt: string
  user: PublicUser
}

export type ProductDTO = {
  id: string
  barcode: string
  name: string
  brand: string
  createdAt: string
  updatedAt: string
}

export type ProductDetailDTO = {
  product: ProductDTO
  current: RevisionDTO | null
  revisions: RevisionDTO[]
  comments: CommentDTO[]
  reviewerCount: number
  pendingCount: number
}

export type SearchItemDTO = ProductDTO & {
  hasImage: boolean
  approvedCount: number
}

export type StatsDTO = {
  products: number
  contributors: number
  pendingCount: number
  approvedCount: number
  recent: {
    id: string
    productName: string
    barcode: string
    version: number
    status: RevisionStatus
    userName: string
    userId: string
    createdAt: string
    /** Field-level value changes vs the previous approved snapshot (empty for new products). */
    changes: { field: string; from: string | null; to: string | null }[]
  }[]
}

export type MeDTO = {
  id: string
  name: string
  email: string
  karma: number
  trustLevel: number
  trustLabel: string
  approvedCount: number
  totalCount: number
  approvalRate: number
} | null

export type ProfileDTO = {
  user: PublicUser
  // present only when the requester is viewing their own profile
  email?: string
  createdAt: string
  reviewsCast: number
  contributions: RevisionDTO[]
}

export type SubmitPayload = {
  barcode: string
  name: string
  brand: string
  ingredients: string
  servingSize?: string | null
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  sugars?: number | null
  fat?: number | null
  salt?: number | null
  frontImage?: string | null
  ingredientsImage?: string | null
  nutritionImage?: string | null
}

export type SubmitResult = {
  revisionId: string
  productId: string
  barcode: string
  version: number
  status: 'approved' | 'auto_approved' | 'pending'
  autoNote: string | null
  requiredApprovals: number
}

// Fields that participate in diffing (in display order).
export const LABEL_FIELDS = [
  'name',
  'brand',
  'ingredients',
  'servingSize',
  'calories',
  'protein',
  'carbs',
  'sugars',
  'fat',
  'salt',
  'frontImage',
  'ingredientsImage',
  'nutritionImage',
] as const

export type LabelField = (typeof LABEL_FIELDS)[number]

export const NUMERIC_FIELDS: LabelField[] = ['calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']
