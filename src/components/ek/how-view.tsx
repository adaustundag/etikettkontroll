'use client'

import { Camera, ClipboardCheck, CheckCheck, Scale } from 'lucide-react'
import { useLang } from '@/lib/i18n'

/** /sa-funkar-verifiering — the review flow and trust levels, for contributors and readers. */
export function HowView() {
  const { t } = useLang()
  const steps = [
    { icon: Camera, body: t('how.step1') },
    { icon: ClipboardCheck, body: t('how.step2') },
    { icon: CheckCheck, body: t('how.step3') },
  ]
  const levels = [t('how.l0'), t('how.l1'), t('how.l2'), t('how.l3')]
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('how.title')}</h1>
      <p className="mt-4 text-lg text-pretty text-muted-foreground">{t('how.intro')}</p>

      <section className="mt-10" aria-labelledby="how-flow">
        <h2 id="how-flow" className="text-xl font-semibold tracking-tight">
          {t('how.flowTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {steps.map(({ icon: Icon, body }, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <p className="pt-1.5 leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="how-levels">
        <h2 id="how-levels" className="text-xl font-semibold tracking-tight">
          {t('how.levelsTitle')}
        </h2>
        <ul className="mt-4 space-y-2">
          {levels.map((body, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-bold text-foreground">
                L{i}
              </span>
              <p className="leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="how-conflict">
        <h2 id="how-conflict" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Scale className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t('how.conflictTitle')}
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{t('how.conflictBody')}</p>
      </section>
    </article>
  )
}
