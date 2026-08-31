'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { I18nProvider } from '@/lib/i18n'
import { useHashRoute, type Route } from '@/lib/router'
import { api, getToken, onDataChanged, setToken } from '@/lib/api'
import { Header } from '@/components/ek/header'
import { Footer } from '@/components/ek/footer'
import { AuthDialog } from '@/components/ek/auth-dialog'
import { HomeView } from '@/components/ek/home-view'
import { ProductView } from '@/components/ek/product-view'
import { SubmitView } from '@/components/ek/submit-view'
import { QueueView } from '@/components/ek/queue-view'
import { ProfileView } from '@/components/ek/profile-view'
import type { MeDTO } from '@/lib/types'

function viewKey(route: Route): string {
  return `${route.view}:${route.param}`
}

function AppShell() {
  const route = useHashRoute()
  const [me, setMe] = useState<MeDTO | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)

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

  const signOut = async () => {
    setToken(null)
    await api.post('/api/auth/logout')
    setMe(null)
    refreshMe()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header me={me} route={route} onSignOut={signOut} onSignIn={() => setAuthOpen(true)} />

      <main className="flex-1">
        {meLoaded && (
          <motion.div
            key={viewKey(route)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {route.view === 'home' && <HomeView me={me} />}
            {route.view === 'product' && <ProductView barcode={route.param} me={me} />}
            {route.view === 'submit' && (
              <SubmitView barcodeParam={route.param} me={me} onNeedAuth={() => setAuthOpen(true)} />
            )}
            {route.view === 'queue' && <QueueView me={me} onNeedAuth={() => setAuthOpen(true)} />}
            {route.view === 'profile' && <ProfileView key={route.param} userId={route.param} meId={me?.id} />}
          </motion.div>
        )}
      </main>

      <Footer />
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} onAuthed={(m) => setMe(m)} />
    </div>
  )
}

export default function Page() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
}
