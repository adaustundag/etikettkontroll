'use client'

import { useEffect, useState } from 'react'
import { Camera, CheckCheck, Percent, ScanSearch } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ek/empty-state'
import { StatusBadge } from '@/components/ek/status-badge'
import { TrustBadge } from '@/components/ek/trust-badge'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { formatDate, initials, navigate, timeAgo } from '@/lib/router'
import { TRUST_THRESHOLDS } from '@/lib/trust'
import type { ProfileDTO } from '@/lib/types'

export function ProfileView({ userId, meId }: { userId: string; meId?: string }) {
  const { t, lang } = useLang()
  const [profile, setProfile] = useState<ProfileDTO | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<ProfileDTO>(`/api/users/${userId}`)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (!meId) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState title={t('profile.signInPrompt')} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState title={t('profile.notFound')} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }

  const nextLevel = profile.user.trustLevel === 0 ? ['trust.1', TRUST_THRESHOLDS.contributor] : profile.user.trustLevel === 1 ? ['trust.2', TRUST_THRESHOLDS.trusted] : profile.user.trustLevel === 2 ? ['trust.3', TRUST_THRESHOLDS.moderator] : null
  const nextThreshold = nextLevel ? (nextLevel[1] as number) : null
  const isSelf = profile.user.id === meId

  const approvedCount = profile.contributions.filter((c) => ['approved', 'auto_approved'].includes(c.status)).length
  const finalized = profile.contributions.filter((c) => c.status !== 'pending').length
  const rate = finalized === 0 ? null : Math.round((approvedCount / finalized) * 100)

  const stats = [
    { icon: Camera, label: t('profile.statContributions'), value: String(profile.contributions.length) },
    { icon: CheckCheck, label: t('profile.statApproved'), value: String(approvedCount) },
    { icon: ScanSearch, label: t('profile.statReviews'), value: String(profile.reviewsCast) },
    { icon: Percent, label: t('profile.statRate'), value: rate === null ? '—' : `${rate}%` },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-emerald-600 text-lg font-semibold text-white">
              {initials(profile.user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{profile.user.name}</h1>
              <TrustBadge level={profile.user.trustLevel} label={profile.user.trustLabel} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isSelf && profile.email ? `${profile.email} · ` : ''}
              {t('profile.memberSince', { date: formatDate(profile.createdAt, lang) })}
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {profile.user.karma} {t('common.karma')}
            </p>
            {nextThreshold !== null ? (
              <div className="mt-2 max-w-sm">
                <Progress value={Math.min(100, (profile.user.karma / nextThreshold) * 100)} className="h-2" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('profile.karmaProgress', {
                    karma: profile.user.karma,
                    next: nextThreshold,
                    label: t(nextLevel![0] as never),
                  })}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t('profile.maxLevel')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {isSelf && profile.emailVerified === false && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          {t('profile.emailUnverified')}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="rounded-2xl">
            <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
              <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span className="text-xl font-bold tabular-nums">{value}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">{t('profile.contributions')}</h2>
      {profile.contributions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('profile.contributionsEmpty')}</p>
      ) : (
        <ul className="mt-3 divide-y rounded-2xl border bg-card">
          {profile.contributions.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate(`product/${c.barcode}`)}
              >
                <p className="truncate text-sm font-medium hover:underline">
                  {c.name} <span className="text-muted-foreground">v{c.version}</span>
                </p>
                <p className="text-xs text-muted-foreground">{timeAgo(c.createdAt, lang)}</p>
              </button>
              <StatusBadge status={c.status}>{t(`status.${c.status}` as never)}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
