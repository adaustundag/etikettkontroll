'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, setToken } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Mail } from 'lucide-react'
import type { MeDTO } from '@/lib/types'

const DEMO_PASSWORD = 'demo1234'

const DEMO_ACCOUNTS: { email: string; roleKey: 'auth.demoMod1' | 'auth.demoMod2' | 'auth.demoL2' | 'auth.demoL1' }[] = [
  { email: 'maja@etikettkontroll.se', roleKey: 'auth.demoMod1' },
  { email: 'erik@etikettkontroll.se', roleKey: 'auth.demoMod2' },
  { email: 'anna@etikettkontroll.se', roleKey: 'auth.demoL2' },
  { email: 'gustav@etikettkontroll.se', roleKey: 'auth.demoL1' },
]

type ProvidersDTO = { google: boolean; facebook: boolean; magic: boolean }
type MagicResult = { emailed: boolean; devLink?: string }

export function AuthDialog({
  open,
  onOpenChange,
  onAuthed,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAuthed: (me: MeDTO) => void
}) {
  const { t } = useLang()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [magicMode, setMagicMode] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [magicEmail, setMagicEmail] = useState('')
  const [magicBusy, setMagicBusy] = useState(false)
  const [magicResult, setMagicResult] = useState<MagicResult | null>(null)
  const [providers, setProviders] = useState<ProvidersDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset transient state whenever the dialog closes (event-handler driven).
  const handleChange = (v: boolean) => {
    if (!v) {
      setError(null)
      setMagicMode(false)
      setMagicResult(null)
      setMagicEmail('')
      setPassword('')
    }
    onOpenChange(v)
  }

  // Which methods does the server actually support? (deferred one tick to
  // satisfy the set-state-in-effect rule)
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      api
        .get<ProvidersDTO>('/api/auth/providers')
        .then(setProviders)
        .catch(() => setProviders(null))
    }, 0)
    return () => clearTimeout(id)
  }, [open])

  const completeSignIn = useCallback(
    async (token: string) => {
      setToken(token)
      const me = await api.get<MeDTO | null>('/api/auth/me')
      if (!me) throw new Error(t('common.errorGeneric'))
      onAuthed(me)
      onOpenChange(false)
      toast.success(t('auth.welcomeToast', { name: me.name }))
    },
    [onAuthed, onOpenChange, t],
  )

  // The OAuth/magic popup hands us the session token via postMessage.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; token?: string } | null
      if (!data || data.type !== 'ek_oauth' || typeof data.token !== 'string' || cancelled) return
      cancelled = true
      completeSignIn(data.token).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('common.errorGeneric'))
      })
    }
    window.addEventListener('message', onMsg)
    return () => {
      cancelled = true
      window.removeEventListener('message', onMsg)
    }
  }, [open, completeSignIn, t])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // Persist the bearer token before /me — the session cookie is dropped
      // inside the preview iframe, the token is what keeps us signed in.
      const res = mode === 'signin'
        ? await api.post<{ token?: string }>('/api/auth/login', { email, password })
        : await api.post<{ token?: string }>('/api/auth/register', { name, email, password })
      if (res?.token) setToken(res.token)

      const me = await api.get<MeDTO | null>('/api/auth/me')
      if (!me) throw new Error(t('common.errorGeneric'))
      onAuthed(me)
      onOpenChange(false)
      toast.success(t('auth.welcomeToast', { name: me.name }))
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const submitMagic = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMagicBusy(true)
    try {
      const res = await api.post<MagicResult>('/api/auth/magic/request', { email: magicEmail, popup: true })
      setMagicResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setMagicBusy(false)
    }
  }

  const startOAuth = (provider: 'google' | 'facebook') => {
    setError(null)
    if (providers && !providers[provider]) {
      setError(t('auth.notConfigured', { provider: provider === 'google' ? 'Google' : 'Facebook' }))
      return
    }
    const w = window.open(`/api/auth/oauth/${provider}/start?popup=1`, 'ek_oauth', 'width=480,height=640,menubar=no,toolbar=no')
    if (!w) setError(t('auth.popupBlocked'))
  }

  // Dev-mode magic link: prefer the popup (postMessage signs the iframe in),
  // fall back to a plain new tab (cookie flow works there).
  const openDevLink = (link: string) => {
    const w = window.open(link, 'ek_oauth', 'width=480,height=640,menubar=no,toolbar=no')
    if (!w) {
      const w2 = window.open(link, '_blank')
      if (!w2) setError(t('auth.popupBlocked'))
    }
  }

  const fillDemo = (demoEmail: string) => {
    setMode('signin')
    setMagicMode(false)
    setEmail(demoEmail)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}</DialogTitle>
          <DialogDescription>{mode === 'signin' ? t('auth.signInSubtitle') : t('auth.signUpSubtitle')}</DialogDescription>
        </DialogHeader>

        {!magicMode && (
          <Tabs value={mode} onValueChange={(v) => { setMode(v as 'signin' | 'signup'); setError(null) }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t('common.signIn')}</TabsTrigger>
              <TabsTrigger value="signup">{t('common.signUp')}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={submit} className="mt-2 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">{t('auth.email')}</Label>
                  <Input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-password">{t('auth.password')}</Label>
                  <Input id="auth-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <Button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                  {t('auth.signInCta')}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={submit} className="mt-2 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">{t('auth.name')}</Label>
                  <Input id="auth-name" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email2">{t('auth.email')}</Label>
                  <Input id="auth-email2" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-password2">{t('auth.password')}</Label>
                  <Input id="auth-password2" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
                </div>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <Button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                  {t('auth.signUpCta')}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {/* alternative sign-in methods */}
        <div className="flex items-center gap-3" role="separator" aria-label={t('auth.orContinue')}>
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{t('auth.orContinue')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {magicMode ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">{t('auth.magicPrompt')}</p>
            {!magicResult ? (
              <form onSubmit={submitMagic} className="flex gap-2">
                <Input
                  type="email"
                  required
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label={t('auth.email')}
                  className="flex-1"
                />
                <Button type="submit" disabled={magicBusy} className="shrink-0 bg-emerald-600 hover:bg-emerald-700">
                  {magicBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Mail className="mr-1 h-4 w-4" aria-hidden />}
                  {t('auth.magicSend')}
                </Button>
              </form>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('auth.magicSent')}</p>
                {magicResult.devLink && (
                  <div className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">{t('auth.magicDevTitle')}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1.5 w-full"
                      onClick={() => openDevLink(magicResult.devLink!)}
                    >
                      <ExternalLink className="mr-1 h-4 w-4" aria-hidden />
                      {t('auth.magicDevOpen')}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { setMagicMode(false); setMagicResult(null); setError(null) }}>
              {t('common.back')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={() => startOAuth('google')}>
              {t('auth.providerGoogle')}
            </Button>
            <Button type="button" variant="outline" onClick={() => startOAuth('facebook')}>
              {t('auth.providerFacebook')}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setMagicMode(true); setError(null) }}>
              <Mail className="mr-1 h-4 w-4" aria-hidden />
              {t('auth.emailLink')}
            </Button>
          </div>
        )}

        {!magicMode && error && <p className="-mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('auth.demoTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('auth.demoBody', { password: DEMO_PASSWORD })}
          </p>
          <ul className="mt-2 space-y-1">
            {DEMO_ACCOUNTS.map((acc) => (
              <li key={acc.email}>
                <button
                  type="button"
                  onClick={() => fillDemo(acc.email)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                >
                  <span className="font-mono">{acc.email}</span>
                  <span className="ml-2 shrink-0 text-muted-foreground">{t(acc.roleKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
