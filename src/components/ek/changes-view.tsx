'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChangeRow } from '@/components/ek/change-item'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import type { ChangesDTO } from '@/lib/types'

/**
 * /andringar — the full public change log. Same rows as the home feed but
 * paginated (20 per page via GET /api/changes?page=N) with every change chip.
 */
export function ChangesView() {
  const { t } = useLang()
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<ChangesDTO['items']>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get<ChangesDTO>('/api/changes')
      .then((d) => {
        if (!alive) return
        setItems(d.items)
        setHasMore(d.hasMore)
        setPage(d.page)
        setLoaded(true)
      })
      .catch(() => {
        if (!alive) return
        setItems([])
        setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const d = await api.get<ChangesDTO>(`/api/changes?page=${page + 1}`)
      setItems((cur) => [...cur, ...d.items])
      setPage(d.page)
      setHasMore(d.hasMore)
    } catch {
      // keep the current list on transient errors
    } finally {
      setLoadingMore(false)
    }
  }, [page])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('changes.title')}</h1>
      <p className="mt-2 max-w-2xl text-pretty text-muted-foreground">{t('changes.subtitle')}</p>

      {!loaded && (
        <div className="mt-8 space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {loaded && items.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">{t('changes.empty')}</p>
      )}

      {items.length > 0 && (
        <ul className="mt-8 divide-y rounded-2xl border bg-card" aria-label={t('nav.changes')}>
          {items.map((r) => (
            <ChangeRow key={r.id} r={r} />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('changes.loading') : t('changes.loadMore')}
            {!loadingMore && <ChevronDown className="ml-1 h-4 w-4" aria-hidden />}
          </Button>
        </div>
      )}
      {hasMore && (
        <p className="sr-only" aria-live="polite">
          {t('changes.loading')}
        </p>
      )}
    </div>
  )
}
