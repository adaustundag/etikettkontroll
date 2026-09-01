'use client'

import { CheckCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AppLink } from '@/components/ek/app-link'
import { useLang, type TKey } from '@/lib/i18n'
import { timeAgo } from '@/lib/router'
import type { ChangeItemDTO } from '@/lib/types'

/**
 * One published revision row for the change feeds (home preview + /andringar
 * full log). Product link, version badge, contributor, relative time and
 * field-level value chips. maxChips trims the chip list (home preview only).
 */
export function ChangeRow({ r, maxChips }: { r: ChangeItemDTO; maxChips?: number }) {
  const { t, lang } = useLang()
  const visible = maxChips ? r.changes.slice(0, maxChips) : r.changes
  const hidden = maxChips ? Math.max(r.changes.length - maxChips, 0) : 0
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <AppLink
          href={`/product/${r.barcode}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
        >
          {r.productName}
        </AppLink>
        {r.version === 1 ? (
          <Badge
            variant="secondary"
            className="shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {t('home.newProduct')}
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            v{r.version}
          </Badge>
        )}
        <AppLink
          href={`/profile/${r.userId}`}
          className="hidden min-w-0 max-w-40 truncate text-xs text-muted-foreground hover:underline sm:block"
        >
          {r.userName}
        </AppLink>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={r.createdAt}>
          {timeAgo(r.createdAt, lang)}
        </time>
      </div>
      {r.version > 1 && r.changes.length > 0 && (
        <div className="ml-7 mt-1.5 flex flex-wrap gap-1.5">
          {visible.map((c) => (
            <span key={c.field} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
              <span className="font-sans text-muted-foreground">{t(`field.${c.field}` as TKey)}:</span>{' '}
              {c.from ?? '—'} <span aria-hidden>→</span> {c.to ?? '—'}
            </span>
          ))}
          {hidden > 0 && <span className="self-center text-xs text-muted-foreground">+{hidden}</span>}
        </div>
      )}
    </li>
  )
}
