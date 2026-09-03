'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck, Camera, FlaskConical, GitCompareArrows, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AppLink } from '@/components/ek/app-link'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { formatDate } from '@/lib/router'
import type { ChangesDTO } from '@/lib/types'

/**
 * Public-beta launch page (launch-readiness T12). Featured stories are drawn
 * ONLY from the verified change stream — real, reviewed, evidenced
 * corrections. Nothing is fabricated; when the evidence does not exist yet,
 * the page says exactly what is missing instead.
 */
export function BetaView() {
  const { t, lang } = useLang()
  const [data, setData] = useState<ChangesDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    api
      .get<ChangesDTO>('/api/changes?page=1')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  // Real verified corrections only: version > 1 with at least one field diff.
  const stories = (data?.items ?? []).filter((i) => i.version > 1 && i.changes.length > 0).slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
        {t('beta.eyebrow')}
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t('beta.title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('beta.intro')}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Camera, text: t('beta.pillar1') },
          { icon: Users, text: t('beta.pillar2') },
          { icon: GitCompareArrows, text: t('beta.pillar3') },
        ].map(({ icon: Icon, text }) => (
          <Card key={text} className="rounded-2xl border-zinc-200 dark:border-zinc-800">
            <CardContent className="flex items-start gap-3 p-4">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <p className="text-sm text-muted-foreground">{text}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mt-12 flex items-center gap-2 text-xl font-semibold tracking-tight">
        <FlaskConical className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        {t('beta.storiesTitle')}
      </h2>

      {loading && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{t('home.loadErrorBody')}</p>}

      {data && !error && stories.length === 0 && (
        <Card className="mt-4 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="p-5 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">{t('beta.noStoriesTitle')}</p>
            <p className="mt-2">{t('beta.noStoriesBody')}</p>
          </CardContent>
        </Card>
      )}

      {stories.length > 0 && (
        <ul className="mt-4 divide-y rounded-2xl border bg-card">
          {stories.map((s) => (
            <li key={s.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <AppLink href={`/product/${s.barcode}`} className="font-medium hover:underline">
                  {s.productName}
                </AppLink>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {t('beta.verified')}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {s.changes.map((c) => (
                  <li key={c.field} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{c.field}</span>: {c.from ?? '—'} → {c.to ?? '—'}
                  </li>
                ))}
              </ul>
              {/* Labeled explicitly as the DATABASE publication time — never as
                  the date the packaging itself changed. */}
              <p className="mt-2 text-xs text-muted-foreground">{t('beta.publishedAt', { date: formatDate(s.createdAt, lang) })}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-12 flex flex-wrap gap-3">
        <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
          <AppLink href="/submit">{t('beta.ctaSubmit')}</AppLink>
        </Button>
        <Button asChild variant="outline">
          <AppLink href="/sa-funkar-verifiering">{t('beta.ctaHow')}</AppLink>
        </Button>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">{t('beta.note')}</p>
    </div>
  )
}
