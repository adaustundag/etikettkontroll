'use client'

import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  body?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center', className)}>
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          {icon}
        </div>
      )}
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      </div>
      {action}
    </div>
  )
}
