'use client'

import { detectAllergens, type MatchRange } from '@/lib/allergens'
import { useLang } from '@/lib/i18n'

export function AllergenText({ text }: { text: string }) {
  const { found, matches } = detectAllergens(text)
  if (matches.length === 0) return <p className="whitespace-pre-wrap leading-relaxed">{text}</p>

  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((m: MatchRange, i) => {
    if (m.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, m.start)}</span>)
    parts.push(
      <mark key={`m${i}`} className="rounded-sm bg-amber-200/80 px-0.5 font-medium text-foreground dark:bg-amber-500/30">
        {text.slice(m.start, m.end)}
      </mark>,
    )
    cursor = m.end
  })
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>)

  return (
    <div>
      <p className="whitespace-pre-wrap leading-relaxed">{parts}</p>
      {found.length > 0 && (
        <p className="sr-only">{found.join(', ')}</p>
      )}
    </div>
  )
}
