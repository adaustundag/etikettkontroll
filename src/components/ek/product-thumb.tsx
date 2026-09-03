'use client'

import { cn } from '@/lib/utils'

export function ProductThumb({
  src,
  name,
  className,
}: {
  src: string | null | undefined
  name: string
  className?: string
}) {
  if (src) {
    return (
      // Decorative: the adjacent link/title carries the product name, so the
      // accessible name is concise instead of "Photo of <name> <name>".
      <img src={src} alt="" aria-hidden="true" className={cn('object-cover', className)} loading="lazy" />
    )
  }
  return (
    <div
      aria-label={name}
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900',
        className,
      )}
    >
      <span className="select-none text-2xl font-semibold text-zinc-400 dark:text-zinc-600" aria-hidden>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </div>
  )
}
