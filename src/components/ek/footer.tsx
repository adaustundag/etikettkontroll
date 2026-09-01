'use client'

import { useLang } from '@/lib/i18n'
import { AppLink } from '@/components/ek/app-link'
import { ScanBarcode } from 'lucide-react'

export function Footer() {
  const { t } = useLang()
  const year = new Date().getFullYear()
  return (
    <footer className="mt-auto border-t bg-muted/30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
        <AppLink
          href="/"
          className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-600 text-white">
            <ScanBarcode className="h-3 w-3" aria-hidden />
          </span>
          <span>
            Etikett<span className="text-emerald-600 dark:text-emerald-400">Kontroll</span>
          </span>
        </AppLink>
        <p className="text-center">{t('footer.license')}</p>
        <p>© {year} EtikettKontroll</p>
      </div>
    </footer>
  )
}
