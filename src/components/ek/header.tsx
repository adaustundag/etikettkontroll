'use client'

import { useCallback, useEffect, useState } from 'react'
import { ScanBarcode, Plus, ClipboardCheck, Sun, Moon, LogOut, User as UserIcon, Menu } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
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
import { AppLink } from '@/components/ek/app-link'
import { api, onDataChanged } from '@/lib/api'
import type { MeDTO, StatsDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { AuthMode } from '@/components/ek/app-shell'

export function Header({
  me,
  route,
  onSignOut,
  onSignIn,
}: {
  me: MeDTO
  route: Route
  onSignOut: () => void
  onSignIn: (mode?: AuthMode) => void
}) {
  const { t, lang, setLang } = useLang()
  const { resolvedTheme, setTheme } = useTheme()
  const [pendingCount, setPendingCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

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

  const navLink = (active: boolean) =>
    cn(
      'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
    )

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <AppLink
          href="/"
          className="flex items-center gap-2 rounded-lg pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={t('nav.home')}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <ScanBarcode className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="text-base font-bold tracking-tight">
            <span className="hidden sm:inline">
              Etikett<span className="text-emerald-600 dark:text-emerald-400">Kontroll</span>
            </span>
            <span className="sm:hidden" aria-hidden>
              <span className="text-base font-bold">
                E<span className="text-emerald-600 dark:text-emerald-400">K</span>
              </span>
            </span>
          </span>
        </AppLink>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          <AppLink href="/" className={navLink(route.view === 'home')} aria-current={route.view === 'home' ? 'page' : undefined}>
            {t('nav.home')}
          </AppLink>
          <AppLink href="/submit" className={navLink(route.view === 'submit')} aria-current={route.view === 'submit' ? 'page' : undefined}>
            {t('nav.add')}
          </AppLink>
          <AppLink href="/queue" className={cn(navLink(route.view === 'queue'), 'relative')} aria-current={route.view === 'queue' ? 'page' : undefined}>
            {t('nav.queue')}
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </AppLink>
          <AppLink href="/andringar" className={navLink(route.view === 'changes')} aria-current={route.view === 'changes' ? 'page' : undefined}>
            {t('nav.changes')}
          </AppLink>
          <AppLink href="/sok" className={navLink(route.view === 'search')} aria-current={route.view === 'search' ? 'page' : undefined}>
            {t('nav.search')}
          </AppLink>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* mobile quick actions */}
          <Button asChild variant="ghost" size="icon" className="relative md:hidden">
            <AppLink href="/queue" aria-label={t('nav.queue')}>
              <ClipboardCheck className="h-5 w-5" aria-hidden />
              {pendingCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                  {pendingCount}
                </span>
              )}
            </AppLink>
          </Button>
          <Button asChild variant="ghost" size="icon" className="md:hidden">
            <AppLink href="/submit" aria-label={t('nav.add')}>
              <Plus className="h-5 w-5" aria-hidden />
            </AppLink>
          </Button>

          {/* language toggle — Swedish first (SE on the left) */}
          <div
            className="flex items-center rounded-lg border bg-muted/50 p-0.5"
            role="group"
            aria-label="Språk / Language"
          >
            {(['sv', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cn(
                  'rounded-md px-2.5 py-2 text-xs font-semibold uppercase transition-colors sm:px-3',
                  lang === l ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l === 'sv' ? 'SE' : 'EN'}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
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
            <>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => onSignIn('signin')}>
                {t('common.signIn')}
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onSignIn('signup')}>
                {t('common.signUp')}
              </Button>
            </>
          )}

          {/* mobile drawer — full nav incl. info pages */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.menu')}>
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>{t('nav.menu')}</SheetTitle>
              </SheetHeader>
              <nav className="mt-2 flex flex-col gap-1 px-2" aria-label="Mobile">
                {[
                  { href: '/', key: 'nav.home', active: route.view === 'home' },
                  { href: '/submit', key: 'nav.add', active: route.view === 'submit' },
                  { href: '/queue', key: 'nav.queue', active: route.view === 'queue' },
                  { href: '/andringar', key: 'nav.changes', active: route.view === 'changes' },
                  { href: '/sok', key: 'nav.search', active: route.view === 'search' },
                ].map(({ href, key, active }) => (
                  <AppLink
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
                    )}
                  >
                    {t(key as 'nav.home')}
                  </AppLink>
                ))}
                <div className="my-2 border-t" role="separator" />
                {[
                  { href: '/om', key: 'footer.about' as const },
                  { href: '/integritet', key: 'footer.privacy' as const },
                  { href: '/sa-funkar-verifiering', key: 'footer.how' as const },
                ].map(({ href, key }) => (
                  <AppLink
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/60"
                  >
                    {t(key)}
                  </AppLink>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
