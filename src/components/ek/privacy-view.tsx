'use client'

import { useLang } from '@/lib/i18n'

/** /integritet — privacy policy in plain Swedish (and English). */
export function PrivacyView() {
  const { t } = useLang()
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('privacy.title')}</h1>
      <p className="mt-4 text-lg text-pretty text-muted-foreground">{t('privacy.intro')}</p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">{t('privacy.accountTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('privacy.accountBody')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">{t('privacy.contentTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('privacy.contentBody')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">{t('privacy.cookieTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('privacy.cookieBody')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">{t('privacy.rightsTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('privacy.rightsBody')}</p>
      </section>
    </article>
  )
}
