'use client'

import { wordDiff } from '@/lib/diff'
import { cn } from '@/lib/utils'

/**
 * Renders old → new as word-level diff. Shows the *proposed* text with
 * deleted words struck through in red and added words in green.
 */
export function DiffText({
  oldText,
  newText,
  className,
}: {
  oldText: string
  newText: string
  className?: string
}) {
  if (oldText === newText) {
    return <p className={cn('whitespace-pre-wrap', className)}>{newText}</p>
  }
  const segments = wordDiff(oldText ?? '', newText ?? '')
  return (
    <p className={cn('whitespace-pre-wrap leading-relaxed', className)}>
      {segments.map((seg, i) => {
        if (seg.type === 'same') return <span key={i}>{seg.value}</span>
        if (seg.type === 'del') {
          return (
            <span key={i} className="rounded-sm bg-red-100 text-red-800 line-through decoration-red-400 dark:bg-red-950/70 dark:text-red-300">
              {seg.value}
            </span>
          )
        }
        return (
          <span key={i} className="rounded-sm bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
            {seg.value}
          </span>
        )
      })}
    </p>
  )
}
