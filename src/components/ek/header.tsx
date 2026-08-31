'use client'

import { useCallback, useEffect, useState } from 'react'
import { ScanBarcode, Plus, ClipboardCheck, Sun, Moon, LogOut, User as UserIcon, Languages } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLang } from '@/lib/i18n'
import { initials, navigate, type Route } from '@/lib/router'
import { api, onDataChanged } from '@/lib/api'
import type { MeDTO, StatsDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export function Header({
  me,
  route,
  onSignOut,
  onSignIn,
}: {
  me: MeDTO
  route: Route
  onSignOut: () => void
  onSignIn: () => void
}) {
  const { t, lang, setLang } = useLang()
  const { resolvedTheme, setTheme } = useTheme()
  const [pendingCount, setPendingCount] = useState(0)

  const fetchPending = useCallback(() => {
    api
      .get<StatsDTO>('/api/stats')
      .then((s) => setPendingCount(s.pendingCount))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    fetchPending()
    return onDataChanged(fetchPending)
  }, [fetchPending, route.view])

  const navBtn = (active: boolean) =>
    cn(
      'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
    )

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => navigate('')}
          className="flex items-center gap-2 rounded-lg pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={t('nav.home')}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <ScanBarcode className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="text-base font-bold tracking-tight">
            Etikett<span className="text-emerald-600 dark:text-emerald-400">Kontroll</span>
          </span>
        </button>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          <button type="button" className={navBtn(route.view === 'home')} onClick={() => navigate('')}>
            {t('nav.home')}
          </button>
          <button type="button" className={navBtn(route.view === 'submit')} onClick={() => navigate('submit')}>
            {t('nav.add')}
          </button>
          <button type="button" className={cn(navBtn(route.view === 'queue'), 'relative')} onClick={() => navigate('queue')}>
            {t('nav.queue')}
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* mobile quick actions */}
          <Button
            variant="ghost"
            size="icon"
            className="relative md:hidden"
            onClick={() => navigate('queue')}
            aria-label={t('nav.queue')}
          >
            <ClipboardCheck className="h-5 w-5" aria-hidden />
            {pendingCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => navigate('submit')}
            aria-label={t('nav.add')}
          >
            <Plus className="h-5 w-5" aria-hidden />
          </Button>

          {/* language toggle */}
          <div
            className="flex items-center rounded-lg border bg-muted/50 p-0.5"
            role="group"
            aria-label="Language / Språk"
          >
            <Languages className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {(['en', 'sv'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-semibold uppercase transition-colors',
                  lang === l ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            <Sun className="hidden h-5 w-5 dark:block" aria-hidden />
            <Moon className="h-5 w-5 dark:hidden" aria-hidden />
          </Button>

          {me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" aria-label={t('nav.profile')}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-emerald-600 text-xs font-semibold text-white">
                      {initials(me.name)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{me.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {me.karma} {t('common.karma')} · {me.trustLabel}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(`profile/${me.id}`)}>
                  <UserIcon className="h-4 w-4" aria-hidden />
                  {t('nav.profile')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOut className="h-4 w-4" aria-hidden />
                  {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onSignIn}>
              {t('common.signIn')}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
