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
      home: 'EtikettKontroll – Vad står egentligen på etiketten?',
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

export default function AppShellRoot({
  initialRoute,
  initialProduct,
}: {
  initialRoute: Route
  initialProduct?: ProductDetailDTO
}) {
  return (
    <I18nProvider>
      <PwaRegister />
      <AppShell initialRoute={initialRoute} initialProduct={initialProduct} />
    </I18nProvider>
  )
}
