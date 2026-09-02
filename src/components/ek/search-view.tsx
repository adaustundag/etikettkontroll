'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductThumb } from '@/components/ek/product-thumb'
import { EmptyState } from '@/components/ek/empty-state'
import { AppLink } from '@/components/ek/app-link'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import type { SearchResponseDTO } from '@/lib/types'

/**
 * Full search results page (/sok). Query and page live in the URL
 * (?q=&page=) so searches are shareable and the back button works; the view
 * listens to popstate to stay in sync with browser navigation.
 */
export function SearchView() {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<SearchResponseDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const readUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    return { q: params.get('q') ?? '', page: Math.max(1, Number(params.get('page')) || 1) }
  }, [])

  const fetchResults = useCallback(async (q: string, page: number) => {
    if (!q.trim()) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const res = await api.get<SearchResponseDTO>(`/api/products?q=${encodeURIComponent(q)}&page=${page}&pageSize=20`)
      setData(res)
    } catch {
      setData({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const { q, page } = readUrl()
    setQuery(q)
    void fetchResults(q, page)
    const onPop = () => {
      const s = readUrl()
      setQuery(s.q)
      void fetchResults(s.q, s.page)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [fetchResults, readUrl])

  const pushUrl = (q: string, page: number) => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    window.history.pushState(null, '', qs ? `/sok?${qs}` : '/sok')
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) {
      setData(null)
      pushUrl('', 1)
      return
    }
    pushUrl(q, 1)
    void fetchResults(q, 1)
  }

  const goToPage = (page: number) => {
    const q = query.trim()
    pushUrl(q, page)
    void fetchResults(q, page)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">{t('search.title')}</h1>

      <form onSubmit={onSearch} className="mt-5 flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="h-11 pl-9"
            autoFocus
          />
        </div>
        <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          {t('search.cta')}
        </Button>
      </form>

      {!data && !loading && <p className="mt-8 text-sm text-muted-foreground">{t('search.intro')}</p>}

      {loading && (
        <div className="mt-8 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {data && !loading && (
        <>
          <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">
            {t('search.resultCount', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                icon={<Search className="h-6 w-6" aria-hidden />}
                title={t('search.noResultsTitle')}
                body={t('search.noResultsBody', { q: query.trim() })}
                action={
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => window.history.pushState(null, '', '/submit')}>
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    {t('search.addCta')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y rounded-2xl border bg-card">
              {data.items.map((p) => (
                <li key={p.id}>
                  <AppLink
                    href={`/product/${p.barcode}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <ProductThumb src={p.frontImage} name={p.name} className="h-12 w-12 shrink-0 rounded-lg text-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.brand} · <span className="font-mono">{p.barcode}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t('search.versions', { count: p.approvedCount })}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}

          {data.pageCount > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => goToPage(data.page - 1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {t('search.prev')}
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {data.page} / {data.pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => goToPage(data.page + 1)}>
                {t('search.next')}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
