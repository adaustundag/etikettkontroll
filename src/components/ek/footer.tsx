'use client'

import { useLang } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import { ScanBarcode } from 'lucide-react'

export function Footer() {
  const { t } = useLang()
  const year = new Date().getFullYear()
  return (
    <footer className="mt-auto border-t bg-muted/30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <ScanBarcode className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-sm font-bold tracking-tight">
              Etikett<span className="text-emerald-600 dark:text-emerald-400">Kontroll</span>
            </span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t('footer.line')}</p>
          <p className="mt-1 text-sm italic text-muted-foreground/70">{t('footer.madeIn')}</p>
        </div>
        <nav className="text-sm" aria-label="Footer">
          <ul className="space-y-2">
            <li>
              <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" onClick={() => navigate('')}>
                {t('nav.home')}
              </button>
            </li>
            <li>
              <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" onClick={() => navigate('submit')}>
                {t('nav.add')}
              </button>
            </li>
            <li>
              <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" onClick={() => navigate('queue')}>
                {t('nav.queue')}
              </button>
            </li>
          </ul>
        </nav>
        <div className="text-sm text-muted-foreground sm:text-right">
          <p>{t('footer.license')}</p>
          <p className="mt-2 text-xs">© {year} EtikettKontroll</p>
        </div>
      </div>
    </footer>
  )
}
