'use client'

import { useEffect, useState } from 'react'
import { Camera, PenLine, CheckCheck, ArrowRight, ClipboardList, Package, Users, GitPullRequestArrow, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchBox } from '@/components/ek/search-box'
import { ProductThumb } from '@/components/ek/product-thumb'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { navigate, timeAgo } from '@/lib/router'
import type { MeDTO, SearchItemDTO, StatsDTO } from '@/lib/types'

export function HomeView({ me }: { me: MeDTO }) {
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

  const statCards = stats
    ? [
        { icon: Package, value: stats.products, label: t('home.statProducts') },
        { icon: Users, value: stats.contributors, label: t('home.statContributors') },
        { icon: GitPullRequestArrow, value: stats.approvedCount, label: t('home.statReviewed') },
        { icon: Clock, value: stats.pendingCount, label: t('home.statPending') },
      ]
    : []

  const steps = [
    { icon: Camera, title: t('home.how1Title'), body: t('home.how1Body') },
    { icon: PenLine, title: t('home.how2Title'), body: t('home.how2Body') },
    { icon: CheckCheck, title: t('home.how3Title'), body: t('home.how3Body') },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      {/* Hero */}
      <section className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{t('home.eyebrow')}</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">{t('home.title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-muted-foreground">{t('home.subtitle')}</p>
        <div className="mx-auto mt-8 max-w-xl">
          <SearchBox />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('submit')}>
            {t('home.addProduct')}
          </Button>
          {stats && stats.pendingCount > 0 && (
            <Button size="lg" variant="outline" onClick={() => navigate('queue')}>
              {t('home.queueTeaser', { count: stats.pendingCount })}
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </section>

      {/* Stats */}
      <section className="mt-12" aria-label="Statistics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {!stats &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          {statCards.map(({ icon: Icon, value, label }) => (
            <Card key={label} className="rounded-2xl border-zinc-200 dark:border-zinc-800">
              <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
                <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span className="text-2xl font-bold tabular-nums">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

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

      {/* Recent activity */}
      <section className="mt-14" aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-xl font-semibold tracking-tight">{t('home.recentTitle')}</h2>
        {!stats && (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        )}
        {stats && stats.recent.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">{t('home.recentEmpty')}</p>
        )}
        {stats && stats.recent.length > 0 && (
          <ul className="mt-4 divide-y rounded-2xl border bg-card">
            {stats.recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <p className="min-w-0 flex-1 truncate text-sm">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => navigate(`profile/${r.userId}`)}
                  >
                    {r.userName}
                  </button>{' '}
                  <span className="text-muted-foreground">
                    {t('home.activity', { user: '', version: r.version, product: '' })}
                  </span>
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => navigate(`product/${r.barcode}`)}
                  >
                    {r.productName}
                  </button>
                </p>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={r.createdAt}>
                  {timeAgo(r.createdAt, lang)}
                </time>
              </li>
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
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`product/${p.barcode}`)}
                className="group overflow-hidden rounded-2xl border bg-card text-left transition-shadow hover:shadow-md"
              >
                <ProductThumb src={null} name={p.name} className="aspect-[4/3] w-full text-3xl transition-transform group-hover:scale-[1.02]" />
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.brand}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

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
              <Button size="sm" variant="outline" className="border-amber-300 dark:border-amber-800" onClick={() => navigate('queue')}>
                {t('home.queueTeaserCta')}
              </Button>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
