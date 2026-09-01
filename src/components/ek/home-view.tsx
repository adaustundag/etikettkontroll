'use client'

import { useEffect, useState } from 'react'
import { Camera, PenLine, CheckCheck, ArrowRight, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchBox } from '@/components/ek/search-box'
import { ProductThumb } from '@/components/ek/product-thumb'
import { AppLink } from '@/components/ek/app-link'
import { ChangeRow } from '@/components/ek/change-item'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import type { MeDTO, SearchItemDTO, StatsDTO } from '@/lib/types'

export function HomeView({ me }: { me: MeDTO | null }) {
  const { t, lang } = useLang()
  const [stats, setStats] = useState<StatsDTO | null>(null)
  const [recentProducts, setRecentProducts] = useState<SearchItemDTO[]>([])

  useEffect(() => {
    const load = () =>
      api
        .get<StatsDTO>('/api/stats')
        .then(setStats)
        .catch(() => undefined)
    load()
    api
      .get<SearchItemDTO[]>('/api/products?q=')
      .then(setRecentProducts)
      .catch(() => undefined)
    return undefined
  }, [])

  const fmt = (n: number) => new Intl.NumberFormat(lang === 'sv' ? 'sv-SE' : 'en-GB').format(n)

  const steps = [
    { icon: Camera, title: t('home.how1Title'), body: t('home.how1Body') },
    { icon: PenLine, title: t('home.how2Title'), body: t('home.how2Body') },
    { icon: CheckCheck, title: t('home.how3Title'), body: t('home.how3Body') },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      {/* Hero — search dead center */}
      <section className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{t('home.eyebrow')}</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">{t('home.title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-muted-foreground">{t('home.subtitle')}</p>
        <div className="mx-auto mt-8 max-w-xl">
          <SearchBox />
        </div>

        {/* live trust line */}
        <div className="mt-4 flex min-h-5 justify-center" aria-live="polite">
          {stats ? (
            <p className="text-sm text-muted-foreground">
              {t('home.trustLine', {
                products: fmt(stats.products),
                contributors: fmt(stats.contributors),
                changes: fmt(stats.approvedCount),
              })}
            </p>
          ) : (
            <Skeleton className="h-5 w-72" />
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700">
            <AppLink href="/submit">{t('home.addProduct')}</AppLink>
          </Button>
          {stats && stats.pendingCount > 0 && (
            <Button asChild size="lg" variant="outline">
              <AppLink href="/queue">
                {t('home.queueTeaser', { count: stats.pendingCount })}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </AppLink>
            </Button>
          )}
        </div>
      </section>

      {/* Change feed — what changed lately */}
      <section className="mt-14" aria-labelledby="recent-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-title" className="text-xl font-semibold tracking-tight">{t('home.recentTitle')}</h2>
          <AppLink href="/andringar" className="shrink-0 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {t('home.viewAllChanges')}
          </AppLink>
        </div>
        {!stats && (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}
        {stats && stats.recent.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">{t('home.recentEmpty')}</p>
        )}
        {stats && stats.recent.length > 0 && (
          <ul className="mt-4 divide-y rounded-2xl border bg-card">
            {stats.recent.map((r) => (
              <ChangeRow key={r.id} r={r} maxChips={4} />
            ))}
          </ul>
        )}
      </section>

      {/* Recently updated products */}
      {recentProducts.length > 0 && (
        <section className="mt-14" aria-labelledby="browse-title">
          <h2 id="browse-title" className="text-xl font-semibold tracking-tight">{t('home.browseTitle')}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {recentProducts.slice(0, 8).map((p) => (
              <AppLink
                key={p.id}
                href={`/product/${p.barcode}`}
                className="group overflow-hidden rounded-2xl border bg-card text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <ProductThumb src={null} name={p.name} className="aspect-[4/3] w-full text-3xl transition-transform group-hover:scale-[1.02]" />
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.brand}</p>
                </div>
              </AppLink>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mt-14" aria-labelledby="how-title">
        <h2 id="how-title" className="text-xl font-semibold tracking-tight">{t('home.howTitle')}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <Card key={title} className="rounded-2xl border-zinc-200 dark:border-zinc-800">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Reviewer teaser */}
      {me && stats && stats.pendingCount > 0 && (
        <section className="mt-14">
          <Card className="rounded-2xl border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
            <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  {t('home.queueTeaser', { count: stats.pendingCount })}
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="border-amber-300 dark:border-amber-800">
                <AppLink href="/queue">{t('home.queueTeaserCta')}</AppLink>
              </Button>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
