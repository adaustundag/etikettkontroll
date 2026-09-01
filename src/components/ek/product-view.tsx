'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  Clock,
  Check,
  X,
  MessageSquare,
  Pencil,
  ZoomIn,
  ScanBarcode,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ProductThumb } from '@/components/ek/product-thumb'
import { StatusBadge } from '@/components/ek/status-badge'
import { UserChip } from '@/components/ek/user-chip'
import { AllergenText } from '@/components/ek/allergen-text'
import { NutritionTable } from '@/components/ek/nutrition-table'
import { DiffText } from '@/components/ek/diff-text'
import { EmptyState } from '@/components/ek/empty-state'
import { api, onDataChanged, notifyDataChanged } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { navigate, timeAgo, formatDate } from '@/lib/router'
import { formatValue } from '@/lib/label'
import { ALLERGEN_LABELS, detectAllergens, type AllergenKey } from '@/lib/allergens'
import { cn } from '@/lib/utils'
import type { LabelField, LabelValues, ProductDetailDTO, RevisionDTO, MeDTO } from '@/lib/types'

type PhotoKey = 'frontImage' | 'ingredientsImage' | 'nutritionImage'

function previousVersionFor(rev: RevisionDTO, all: RevisionDTO[]): RevisionDTO | null {
  const candidates = all.filter(
    (r) => r.version < rev.version && ['approved', 'superseded', 'auto_approved'].includes(r.status),
  )
  return candidates.sort((a, b) => b.version - a.version)[0] ?? null
}

function FieldDiffRow({
  field,
  prev,
  next,
}: {
  field: LabelField
  prev: string | number | null
  next: string | number | null
}) {
  const { t } = useLang()
  const isImage = field.endsWith('Image')

  if (isImage) {
    const prevStr = prev === null || prev === undefined || prev === '' ? null : String(prev)
    const nextStr = next === null || next === undefined || next === '' ? null : String(next)
    if (!prevStr && !nextStr) return null
    const changed = prevStr !== nextStr
    return (
      <div className="py-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`field.${field}` as never)}</p>
        {changed ? (
          <div className="mt-1 flex items-center gap-3">
            {prev ? (
               
              <img src={String(prev)} alt="" className="h-16 w-16 rounded-lg object-cover opacity-60" />
            ) : null}
            {prev && next ? <span className="text-xs text-muted-foreground">→</span> : null}
            {next ? (
               
              <img src={String(next)} alt="" className="h-16 w-16 rounded-lg object-cover ring-2 ring-emerald-400" />
            ) : null}
            {!next && <span className="text-xs text-red-600 dark:text-red-400">{t('product.noData')}</span>}
          </div>
        ) : (
           
          <img src={String(next)} alt="" className="mt-1 h-16 w-16 rounded-lg object-cover" />
        )}
      </div>
    )
  }

  if (field === 'ingredients') {
    return (
      <div className="py-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('product.ingredients')}</p>
        <DiffText oldText={String(prev ?? '')} newText={String(next ?? '')} className="mt-1 text-sm" />
      </div>
    )
  }

  const oldStr = formatValue(field as never, prev)
  const newStr = formatValue(field as never, next)
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`field.${field}` as never)}
      </span>
      {oldStr === newStr ? (
        <span className="text-sm">{newStr}</span>
      ) : (
        <span className="text-sm">
          <span className="rounded-sm bg-red-100 text-red-800 line-through dark:bg-red-950/70 dark:text-red-300">{oldStr}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="rounded-sm bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">{newStr}</span>
        </span>
      )}
    </div>
  )
}

function RevisionCard({
  rev,
  all,
  defaultOpen,
}: {
  rev: RevisionDTO
  all: RevisionDTO[]
  defaultOpen?: boolean
}) {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(defaultOpen ?? false)
  const prev = useMemo(() => previousVersionFor(rev, all), [rev, all])
  const isInitial = rev.version === 1 && !prev
  const reviews = rev.reviews

  return (
    <li className="relative pl-8">
      <span
        className={cn(
          'absolute left-0 top-4 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background',
          rev.status === 'rejected'
            ? 'border-red-300 text-red-500 dark:border-red-800'
            : rev.status === 'pending'
              ? 'border-amber-300 text-amber-500 dark:border-amber-800'
              : 'border-emerald-300 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400',
        )}
      >
        {rev.status === 'rejected' ? <X className="h-3 w-3" aria-hidden /> : rev.status === 'pending' ? <Clock className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
      </span>
      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">
              {t('product.version')} {rev.version}
            </CardTitle>
            <StatusBadge status={rev.status}>{t(`status.${rev.status}` as never)}</StatusBadge>
            <UserChip user={rev.submittedBy} />
            <time className="ml-auto text-xs text-muted-foreground" dateTime={rev.createdAt}>
              {timeAgo(rev.createdAt, lang)}
            </time>
          </div>
          {rev.autoNote && <p className="text-xs italic text-muted-foreground">{rev.autoNote}</p>}
        </CardHeader>
        <CardContent className="pt-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            aria-expanded={open}
          >
            {open ? t('common.close') : isInitial ? t('product.initialVersion') : t('product.diffVsPrevious')}
          </button>

          {open && (
            <div className="mt-3 rounded-xl border bg-muted/30 p-3">
              {isInitial ? (
                <div>
                  <FieldDiffRow field="name" prev={null} next={rev.name} />
                  <FieldDiffRow field="brand" prev={null} next={rev.brand} />
                  <FieldDiffRow field="ingredients" prev={null} next={rev.ingredients} />
                  {(rev.calories !== null || rev.protein !== null) && (
                    <>
                      <FieldDiffRow field="calories" prev={null} next={rev.calories} />
                      <FieldDiffRow field="fat" prev={null} next={rev.fat} />
                      <FieldDiffRow field="carbs" prev={null} next={rev.carbs} />
                      <FieldDiffRow field="protein" prev={null} next={rev.protein} />
                      <FieldDiffRow field="salt" prev={null} next={rev.salt} />
                    </>
                  )}
                </div>
              ) : (
                <div>
                  {(['name', 'brand', 'ingredients'] as LabelField[]).map((f) => (
                    <FieldDiffRow
                      key={f}
                      field={f}
                      prev={(prev as unknown as LabelValues)[f] ?? null}
                      next={(rev as unknown as LabelValues)[f] ?? null}
                    />
                  ))}
                  {(['calories', 'protein', 'carbs', 'sugars', 'fat', 'salt'] as LabelField[]).some(
                    (f) => (prev as unknown as LabelValues)[f] !== (rev as unknown as LabelValues)[f],
                  ) && (
                    <div className="mt-2 border-t pt-2">
                      {(['calories', 'protein', 'carbs', 'sugars', 'fat', 'salt'] as LabelField[]).map((f) => (
                        <FieldDiffRow
                          key={f}
                          field={f}
                          prev={(prev as unknown as LabelValues)[f] ?? null}
                          next={(rev as unknown as LabelValues)[f] ?? null}
                        />
                      ))}
                    </div>
                  )}
                  {(['frontImage', 'ingredientsImage', 'nutritionImage'] as LabelField[]).map((f) => (
                    <FieldDiffRow
                      key={f}
                      field={f}
                      prev={(prev as unknown as LabelValues)[f] ?? null}
                      next={(rev as unknown as LabelValues)[f] ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {reviews.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('product.reviewComments')}
              </p>
              {reviews.map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-sm">
                  {r.verdict === 'approve' ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" aria-hidden />
                  )}
                  <p className="min-w-0">
                    <span className="font-medium">{r.reviewer.name}</span>
                    {r.comment && <span className="text-muted-foreground"> — {r.comment}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  )
}

export function ProductView({
  barcode,
  me,
  initialDetail,
}: {
  barcode: string
  me: MeDTO | null
  /** Server-fetched detail (SSR) — skips the initial client fetch when present. */
  initialDetail?: ProductDetailDTO
}) {
  const { t, lang } = useLang()
  const [detail, setDetail] = useState<ProductDetailDTO | null>(initialDetail ?? null)
  const [notFound, setNotFound] = useState(false)
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  // Stable for this mount: true when hydration starts from server data.
  const [hasInitial] = useState(initialDetail !== undefined)
  // Mirror of `detail` for the failure path — avoids stale-closure reads.
  const detailRef = useRef<ProductDetailDTO | null>(initialDetail ?? null)

  const load = useCallback(() => {
    api
      .get<ProductDetailDTO>(`/api/products/${encodeURIComponent(barcode)}`)
      .then((d) => {
        detailRef.current = d
        setDetail(d)
        setNotFound(false)
      })
      .catch(() => {
        // With SSR content already on screen, survive transient refresh errors
        // instead of flipping the whole page to "not found".
        if (!detailRef.current) setNotFound(true)
      })
  }, [barcode])

  useEffect(() => {
    if (!hasInitial) load()
    return onDataChanged(load)
  }, [load, hasInitial])

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) return
    setPosting(true)
    try {
      await api.post(`/api/products/${encodeURIComponent(barcode)}/comments`, { body: comment.trim() })
      setComment('')
      load()
      notifyDataChanged()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setPosting(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <EmptyState
          icon={<ScanBarcode className="h-6 w-6" aria-hidden />}
          title={t('product.notFoundTitle')}
          body={t('product.notFoundBody', { barcode })}
          action={
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate(`submit/${barcode}`)}>
              {t('product.notFoundCta', { barcode })}
            </Button>
          }
        />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  const current = detail.current
  const photos: { key: PhotoKey; label: string }[] = current
    ? ([
        ['frontImage', t('product.front')],
        ['ingredientsImage', t('product.photoIngredients')],
        ['nutritionImage', t('product.photoNutrition')],
      ] as const)
        .map(([key, label]) => ({ key, label }))
        .filter((p) => current[p.key])
    : []

  const seen = new Map<string, RevisionDTO['submittedBy']>()
  for (const r of detail.revisions) {
    if (['approved', 'auto_approved'].includes(r.status)) seen.set(r.submittedBy.id, r.submittedBy)
  }
  const contributors = [...seen.values()]

  const allergens: AllergenKey[] = current ? detectAllergens(current.ingredients).found : []

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <ProductThumb src={current?.frontImage ?? null} name={detail.product.name} className="h-36 w-full shrink-0 rounded-2xl sm:h-36 sm:w-36" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{detail.product.name}</h1>
          <p className="mt-0.5 text-muted-foreground">{detail.product.brand}</p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <ScanBarcode className="h-3.5 w-3.5" aria-hidden />
            {detail.product.barcode}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {current ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <BadgeCheck className="h-4 w-4" aria-hidden />
                {t('product.verified', { count: detail.reviewerCount })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                <Clock className="h-4 w-4" aria-hidden />
                {t('product.unverified')}
              </span>
            )}
            {detail.pendingCount > 0 && (
              <button
                type="button"
                onClick={() => navigate('queue')}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:bg-amber-950 dark:text-amber-300"
              >
                <Clock className="h-4 w-4" aria-hidden />
                {t('product.pendingBanner', { count: detail.pendingCount })}
              </button>
            )}
          </div>
          <div className="mt-4">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate(`submit/${detail.product.barcode}`)}>
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
              {t('product.proposeEdit')}
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">{t('product.tabOverview')}</TabsTrigger>
          <TabsTrigger value="history">{t('product.tabHistory')} ({detail.revisions.length})</TabsTrigger>
          <TabsTrigger value="discuss">{t('product.tabDiscuss')} ({detail.comments.length})</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {!current && (
            <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
              <CardContent className="p-4 text-sm text-amber-900 dark:text-amber-200">{t('product.awaitingFirst')}</CardContent>
            </Card>
          )}
          {current && (
            <>
              {photos.length > 0 && (
                <section aria-label={t('product.photos')}>
                  <div className="grid grid-cols-3 gap-3">
                    {photos.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setZoom({ src: current[p.key] as string, label: p.label })}
                        className="group relative overflow-hidden rounded-xl border"
                        aria-label={`${t('common.viewProduct')}: ${p.label}`}
                      >
                        { }
                        <img src={current[p.key] as string} alt={p.label} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                        <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                          <ZoomIn className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {p.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('product.ingredients')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <AllergenText text={current.ingredients} />
                  {allergens.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('product.contains')}:</span>
                      {allergens.map((a) => (
                        <Badge key={a} variant="secondary" className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                          {ALLERGEN_LABELS[a][lang]}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">{t('product.allergenNote')}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('product.nutrition')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <NutritionTable values={current} />
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                {t('product.lastUpdated', { date: formatDate(current.finalizedAt ?? current.createdAt, lang) })}
                {contributors.length > 0 && (
                  <>
                    {' · '}
                    {t('product.contributors')}: {contributors.map((c) => c.name).join(', ')}
                  </>
                )}
              </p>
            </>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          {detail.revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('product.historyEmpty')}</p>
          ) : (
            <ol className="space-y-4">
              {detail.revisions.map((rev) => (
                <RevisionCard key={rev.id} rev={rev} all={detail.revisions} defaultOpen={rev.status === 'pending'} />
              ))}
            </ol>
          )}
        </TabsContent>

        {/* Discuss */}
        <TabsContent value="discuss" className="mt-4 space-y-4">
          {detail.comments.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('product.discussEmpty')}</p>
          )}
          <ul className="space-y-3">
            {detail.comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <UserChip user={c.user} showTrust={false} />
                <div className="min-w-0 flex-1 rounded-2xl bg-muted/50 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  <time className="mt-1 block text-xs text-muted-foreground" dateTime={c.createdAt}>
                    {timeAgo(c.createdAt, lang)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
          {me ? (
            <form onSubmit={addComment} className="flex gap-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('product.discussPlaceholder')}
                rows={2}
                maxLength={1000}
                className="min-h-11"
                aria-label={t('product.discussPlaceholder')}
              />
              <Button type="submit" disabled={posting || !comment.trim()} className="bg-emerald-600 hover:bg-emerald-700">
                <MessageSquare className="mr-1 h-4 w-4" aria-hidden />
                {t('product.discussSend')}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t('product.signInToDiscuss')}</p>
          )}
        </TabsContent>
      </Tabs>

      {/* Image zoom */}
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="sm:max-w-2xl">
          {zoom && (
            <div>
              <DialogTitle className="sr-only">{zoom.label}</DialogTitle>
              { }
              <img src={zoom.src} alt={zoom.label} className="max-h-[70vh] w-full rounded-xl object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

