'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { toast } from 'sonner'
import type { MeDTO } from '@/lib/types'

const DEMO_PASSWORD = 'demo1234'

const DEMO_ACCOUNTS: { email: string; roleKey: 'auth.demoMod1' | 'auth.demoMod2' | 'auth.demoL2' | 'auth.demoL1' }[] = [
  { email: 'maja@etikettkontroll.se', roleKey: 'auth.demoMod1' },
  { email: 'erik@etikettkontroll.se', roleKey: 'auth.demoMod2' },
  { email: 'anna@etikettkontroll.se', roleKey: 'auth.demoL2' },
  { email: 'gustav@etikettkontroll.se', roleKey: 'auth.demoL1' },
]

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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await api.post('/api/auth/login', { email, password })
      } else {
        await api.post('/api/auth/register', { name, email, password })
      }
      const me = await api.get<MeDTO>('/api/auth/me')
      onAuthed(me)
      onOpenChange(false)
      if (me) toast.success(t('auth.welcomeToast', { name: me.name }))
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const fillDemo = (demoEmail: string) => {
    setMode('signin')
    setEmail(demoEmail)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}</DialogTitle>
          <DialogDescription>{mode === 'signin' ? t('auth.signInSubtitle') : t('auth.signUpSubtitle')}</DialogDescription>
        </DialogHeader>

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
                {t('auth.signUpCta')}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

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
