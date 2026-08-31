'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  X,
  Loader2,
  ClipboardList,
  Keyboard,
  ShieldAlert,
  ImageOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ek/empty-state'
import { UserChip } from '@/components/ek/user-chip'
import { DiffText } from '@/components/ek/diff-text'
import { api, notifyDataChanged } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { navigate, timeAgo } from '@/lib/router'
import { toast } from 'sonner'
import type { LabelField, MeDTO, RevisionDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

type ReviewResponse = {
  finalized: boolean
  status: 'pending' | 'approved' | 'rejected'
  approvedCount: number
  rejectedCount: number
}

function QueueCard({
  item,
  focused,
  canReview,
  onDone,
}: {
  item: RevisionDTO
  focused: boolean
  canReview: boolean
  onDone: (id: string, res: ReviewResponse) => void
}) {
  const { t, lang } = useLang()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const current = item.current ?? null

  const act = async (verdict: 'approve' | 'reject') => {
    if (busy) return
    setBusy(verdict)
    try {
      const res = await api.post<ReviewResponse>(`/api/revisions/${item.id}/review`, {
        verdict,
        comment: comment.trim() || undefined,
      })
      onDone(item.id, res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  const changedFields = item.changedFields as LabelField[]
  const photos = (
    [
      ['frontImage', t('submit.front')],
      ['ingredientsImage', t('submit.photoIngredients')],
      ['nutritionImage', t('submit.photoNutrition')],
    ] as const
  ).filter(([key]) => (item as unknown as Record<string, string | null>)[key])

  return (
    <Card
      className={cn(
        'rounded-2xl transition-shadow',
        focused ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500' : 'border-zinc-200 dark:border-zinc-800',
      )}
      data-queue-card={item.id}
    >
      <CardContent className="p-5">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="text-base font-semibold hover:underline"
            onClick={() => navigate(`product/${item.barcode}`)}
          >
            {item.name}
          </button>
          <Badge variant="outline" className="font-mono text-xs">
            v{item.version}
          </Badge>
          {item.version === 1 && <Badge className="bg-emerald-600 text-white">{t('common.new')}</Badge>}
          <span className="text-sm text-muted-foreground">
            {t('queue.changedBy')} <UserChip user={item.submittedBy} />
          </span>
          <time className="ml-auto text-xs text-muted-foreground" dateTime={item.createdAt}>
            {timeAgo(item.createdAt, lang)}
          </time>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{item.barcode}</p>

        {/* approval progress */}
        <div className="mt-3 flex items-center gap-3">
          <Progress value={(item.approvedCount / Math.max(1, item.requiredApprovals)) * 100} className="h-1.5 w-40" />
          <span className="text-xs text-muted-foreground">
            {t('queue.approvals', { count: item.approvedCount, required: item.requiredApprovals })}
          </span>
          {item.reviews.map((r) => (
            <span key={r.id} className="flex items-center gap-1 text-xs text-muted-foreground">
              {r.verdict === 'approve' ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5 text-red-500" aria-hidden />
              )}
              {r.reviewer.name}
            </span>
          ))}
        </div>

        {/* photos */}
        <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
          {photos.length === 0 && (
            <p className="col-span-3 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <ImageOff className="h-4 w-4" aria-hidden />
              {t('queue.noPhotos')}
            </p>
          )}
          {photos.map(([key, label]) => (
            <figure key={key} className="overflow-hidden rounded-lg border">
              { }
              <img
                src={(item as unknown as Record<string, string | null>)[key] as string}
                alt={label}
                className="aspect-square w-full object-cover"
              />
              <figcaption className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{label}</figcaption>
            </figure>
          ))}
        </div>

        {/* diff */}
        <div className="mt-4 rounded-xl border bg-muted/30 p-3">
          {(['name', 'brand'] as LabelField[]).map((f) => {
            const next = (item as unknown as Record<string, string>)[f]
            const prev = (current as unknown as Record<string, string> | null)?.[f] ?? ''
            if (prev === next) return null
            return (
              <div key={f} className="mb-2 flex items-baseline gap-2">
                <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`field.${f}` as never)}
                </span>
                <span className="text-sm">
                  <span className="rounded-sm bg-red-100 line-through dark:bg-red-950/70">{prev || '—'}</span>
                  <span className="mx-1">→</span>
                  <span className="rounded-sm bg-emerald-100 font-medium dark:bg-emerald-950/70">{next}</span>
                </span>
              </div>
            )
          })}

          {changedFields.includes('ingredients') || item.version === 1 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('product.ingredients')}</p>
              {current ? (
                <DiffText oldText={current.ingredients} newText={item.ingredients} className="mt-1 text-sm" />
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm">{item.ingredients}</p>
              )}
            </div>
          ) : null}

          {(['calories', 'protein', 'carbs', 'sugars', 'fat', 'salt'] as LabelField[]).map((f) => {
            const next = (item as unknown as Record<string, number | null>)[f] ?? null
            const prev = (current as unknown as Record<string, number | null> | null)?.[f] ?? null
            if (prev === next) return null
            return (
              <div key={f} className="flex items-baseline gap-2 py-0.5">
                <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`field.${f}` as never)}
                </span>
                <span className="text-sm tabular-nums">
                  <span className="rounded-sm bg-red-100 line-through dark:bg-red-950/70">{prev ?? '—'}</span>
                  <span className="mx-1">→</span>
                  <span className="rounded-sm bg-emerald-100 font-medium dark:bg-emerald-950/70">{next ?? '—'}</span>
                </span>
              </div>
            )
          })}

          {(['frontImage', 'ingredientsImage', 'nutritionImage'] as LabelField[]).map((f) => {
            const next = (item as unknown as Record<string, string | null>)[f] ?? null
            const prev = (current as unknown as Record<string, string | null> | null)?.[f] ?? null
            if (prev === next) return null
            return (
              <div key={f} className="flex items-center gap-2 py-1">
                <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`field.${f}` as never)}
                </span>
                <div className="flex items-center gap-2">
                  {prev && (
                     
                    <img src={prev} alt="" className="h-12 w-12 rounded-md object-cover opacity-60" />
                  )}
                  {prev && next && <span className="text-xs">→</span>}
                  {next && (
                     
                    <img src={next} alt="" className="h-12 w-12 rounded-md object-cover ring-2 ring-emerald-400" />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* actions */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('queue.commentPlaceholder')}
            maxLength={500}
            className="flex-1"
            aria-label={t('queue.commentPlaceholder')}
          />
          <div className="flex gap-2">
            <Button
              disabled={!canReview || busy !== null}
              onClick={() => void act('reject')}
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              {busy === 'reject' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <X className="mr-1 h-4 w-4" aria-hidden />}
              {t('queue.reject')}
            </Button>
            <Button
              disabled={!canReview || busy !== null}
              onClick={() => void act('approve')}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {busy === 'approve' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Check className="mr-1 h-4 w-4" aria-hidden />}
              {t('queue.approve')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function QueueView({ me, onNeedAuth }: { me: MeDTO; onNeedAuth: () => void }) {
  const { t } = useLang()
  const [items, setItems] = useState<RevisionDTO[] | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api
      .get<RevisionDTO[]>('/api/queue')
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  useEffect(load, [load])

  const onDone = useCallback((id: string, res: ReviewResponse) => {
    setItems((list) => (list ? list.filter((i) => i.id !== id) : list))
    if (res.status === 'approved') toast.success(t('queue.publishedToast'))
    else if (res.status === 'rejected') toast.success(t('queue.rejectedToast'))
    else toast.success(t('queue.approvedToast'))
    notifyDataChanged()
  }, [t])

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!items || items.length === 0) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        setFocusIdx((i) => {
          const next = e.key === 'j' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
          listRef.current
            ?.querySelector(`[data-queue-card="${items[next]?.id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return next
        })
      }
      if (e.key === 'a' || e.key === 'r') {
        const item = items[focusIdx]
        if (!item || !me || me.trustLevel < 2) return
        if (item.submittedBy.id === me.id) return
        e.preventDefault()
        void api
          .post<ReviewResponse>(`/api/revisions/${item.id}/review`, { verdict: e.key === 'a' ? 'approve' : 'reject' })
          .then((res) => onDone(item.id, res))
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t('common.errorGeneric')))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [items, focusIdx, me, onDone, t])

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" aria-hidden />}
          title={t('queue.signInPrompt')}
          action={<Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onNeedAuth}>{t('common.signIn')}</Button>}
        />
      </div>
    )
  }

  if (me.trustLevel < 2) {
    const nextThreshold = 100
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6 text-amber-500" aria-hidden />}
          title={t('queue.needTrust')}
          body={t('queue.needTrustBody')}
          action={
            <div className="w-full max-w-xs">
              <Progress value={Math.min(100, (me.karma / nextThreshold) * 100)} className="h-2" />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {t('profile.karmaProgress', { karma: me.karma, next: nextThreshold, label: t('trust.2') })}
              </p>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('queue.title')}</h1>
        {items && items.length > 0 && (
          <Badge variant="secondary" className="tabular-nums">{items.length}</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('queue.subtitle')}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Keyboard className="h-3.5 w-3.5" aria-hidden />
        {t('queue.shortcutHint')}
      </p>

      <div ref={listRef} className="mt-6 space-y-4">
        {!items && (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        )}
        {items && items.length === 0 && (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" aria-hidden />}
            title={t('queue.empty')}
            body={t('queue.emptyBody')}
          />
        )}
        {items?.map((item, idx) => (
          <QueueCard
            key={item.id}
            item={item}
            focused={idx === focusIdx}
            canReview={me.trustLevel >= 2 && item.submittedBy.id !== me.id}
            onDone={onDone}
          />
        ))}
      </div>
    </div>
  )
}
