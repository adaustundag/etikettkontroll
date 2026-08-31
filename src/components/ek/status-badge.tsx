'use client'

import { Badge } from '@/components/ui/badge'
import { Check, Zap, Clock, X, Archive } from 'lucide-react'
import type { RevisionStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAP: Record<RevisionStatus, { className: string; icon: React.ReactNode }> = {
  approved: {
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    icon: <Check className="h-3 w-3" aria-hidden />,
  },
  auto_approved: {
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    icon: <Zap className="h-3 w-3" aria-hidden />,
  },
  pending: {
    className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    icon: <Clock className="h-3 w-3" aria-hidden />,
  },
  rejected: {
    className: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
    icon: <X className="h-3 w-3" aria-hidden />,
  },
  superseded: {
    className: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
    icon: <Archive className="h-3 w-3" aria-hidden />,
  },
}

export function StatusBadge({ status, children, className }: { status: RevisionStatus; children: React.ReactNode; className?: string }) {
  const cfg = MAP[status]
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', cfg?.className, className)}>
      {cfg?.icon}
      {children}
    </Badge>
  )
}
