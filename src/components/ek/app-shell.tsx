'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { I18nProvider } from '@/lib/i18n'
import { useRoute, type Route } from '@/lib/router'
import { api, getToken, onDataChanged, setToken } from '@/lib/api'
import { Header } from '@/components/ek/header'
import { Footer } from '@/components/ek/footer'
import { AuthDialog } from '@/components/ek/auth-dialog'
import { HomeView } from '@/components/ek/home-view'
import { ProductView } from '@/components/ek/product-view'
import { SubmitView } from '@/components/ek/submit-view'
import { QueueView } from '@/components/ek/queue-view'
import { ProfileView } from '@/components/ek/profile-view'
import { ChangesView } from '@/components/ek/changes-view'
import { AboutView } from '@/components/ek/about-view'
import { PrivacyView } from '@/components/ek/privacy-view'
import { HowView } from '@/components/ek/how-view'
import { SearchView } from '@/components/ek/search-view'
import { BetaView } from '@/components/ek/beta-view'
import { PwaRegister } from '@/components/ek/pwa-register'
import type { MeDTO, ProductDetailDTO } from '@/lib/types'

function viewKey(route: Route): string {
  return `${route.view}:${route.param}`
}

export type AuthMode = 'signin' | 'signup'

// Views that render for anonymous visitors and must not wait for the auth
// probe — they appear in the SSR HTML and paint immediately on slow links.
const PUBLIC_VIEWS = new Set<Route['view']>(['home', 'product', 'changes', 'about', 'privacy', 'how', 'search', 'beta'])

function AppShell({ initialRoute, initialProduct }: { initialRoute: Route; initialProduct?: ProductDetailDTO }) {
  const route = useRoute(initialRoute)
  const [me, setMe] = useState<MeDTO | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')

  const openAuth = useCallback((mode: AuthMode = 'signin') => {
    setAuthMode(mode)
    setAuthOpen(true)
  }, [])

  const refreshMe = useCallback(() => {
    api
      .get<MeDTO | null>('/api/auth/me')
      .then((m) => {
        if (!m && getToken()) setToken(null) // stale/expired token — clean up
        setMe(m ?? null)
      })
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true))
  }, [])

  useEffect(() => {
    refreshMe()
    return onDataChanged(refreshMe)
  }, [refreshMe])

  // Client-side navigation keeps the document title in sync with the view
  // (server routes carry their own metadata via generateMetadata).
  useEffect(() => {
    const titles: Partial<Record<Route['view'], string>> = {
      home: 'EtikettKontroll – Vad står faktiskt på etiketten?',
      submit: 'Lägg till produkt – EtikettKontroll',
      queue: 'Granskningskö – EtikettKontroll',
      changes: 'Ändringar – EtikettKontroll',
      about: 'Om – EtikettKontroll',
      privacy: 'Integritet – EtikettKontroll',
      how: 'Så funkar verifiering – EtikettKontroll',
      search: 'Sök produkter – EtikettKontroll',
    }
    document.title = titles[route.view] ?? 'EtikettKontroll'
  }, [route.view])

  const signOut = async () => {
    setToken(null)
    await api.post('/api/auth/logout')
    setMe(null)
    refreshMe()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header me={me} route={route} onSignOut={signOut} onSignIn={openAuth} />

      <main className="flex-1">
        {(meLoaded || PUBLIC_VIEWS.has(route.view)) && (
          <motion.div
            key={viewKey(route)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {route.view === 'home' && <HomeView me={me} />}
            {route.view === 'product' && (
              <ProductView
                barcode={route.param}
                me={me}
                // SSR data only applies to the barcode actually in the URL.
                initialDetail={initialProduct?.product.barcode === route.param ? initialProduct : undefined}
              />
            )}
            {route.view === 'submit' && (
              <SubmitView barcodeParam={route.param} me={me} onNeedAuth={() => openAuth('signin')} />
            )}
            {route.view === 'queue' && <QueueView me={me} onNeedAuth={() => openAuth('signin')} />}
            {route.view === 'profile' && <ProfileView key={route.param} userId={route.param} meId={me?.id} />}
            {route.view === 'changes' && <ChangesView />}
            {route.view === 'about' && <AboutView />}
            {route.view === 'privacy' && <PrivacyView />}
            {route.view === 'how' && <HowView />}
            {route.view === 'search' && <SearchView />}
            {route.view === 'beta' && <BetaView />}
          </motion.div>
        )}
      </main>

      <Footer />
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        initialMode={authMode}
        onAuthed={(m) => setMe(m)}
      />
    </div>
  )
}

export type QuarantineNotice = {
  barcode: string
  name: string
  reason: string | null
}

export default function AppShellRoot({
  initialRoute,
  initialProduct,
  quarantineNotice,
}: {
  initialRoute: Route
  initialProduct?: ProductDetailDTO
  quarantineNotice?: QuarantineNotice
}) {
  if (quarantineNotice) {
    return (
      <I18nProvider>
        <PwaRegister />
        <QuarantineView notice={quarantineNotice} />
      </I18nProvider>
    )
  }
  return (
    <I18nProvider>
      <PwaRegister />
      <AppShell initialRoute={initialRoute} initialProduct={initialProduct} />
    </I18nProvider>
  )
}

/** EK-01: honest notice for withheld records — no label data, reason shown. */
function QuarantineView({ notice }: { notice: QuarantineNotice }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950">
        <span aria-hidden className="text-xl">
          ⚠️
        </span>
      </div>
      <h1 className="mt-4 text-xl font-bold">Posten är inte tillgänglig</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {notice.reason === 'demo'
          ? 'Den här posten härstammar från testdata (demo) och visas inte som riktig produktinformation. Den finns kvar i arkivet men är inte offentlig.'
          : 'Den här posten är tillfälligt borttagen från offentligheten i väntan på ursprungsgranskning.'}
      </p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{notice.barcode}</p>
      <a href="/" className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
        Till startsidan
      </a>
    </div>
  )
}
