'use client'

import { useLang } from '@/lib/i18n'

/** /om — about the project. */
export function AboutView() {
  const { t } = useLang()
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('about.title')}</h1>
      <p className="mt-4 text-lg text-pretty text-muted-foreground">{t('about.intro')}</p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">{t('about.whyTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('about.whyBody')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">{t('about.howTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('about.howBody')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">{t('about.licenseTitle')}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('about.licenseBody')}</p>
      </section>
    </article>
  )
}
