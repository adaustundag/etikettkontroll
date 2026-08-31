'use client'

import { Badge } from '@/components/ui/badge'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TrustBadge({ level, label, className }: { level: number; label: string; className?: string }) {
  if (level >= 3) {
    return (
      <Badge className={cn('gap-1 bg-zinc-900 text-zinc-50 hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900', className)}>
        <ShieldCheck className="h-3 w-3" aria-hidden />
        {label}
      </Badge>
    )
  }
  if (level === 2) {
    return (
      <Badge className={cn('bg-emerald-600 text-white hover:bg-emerald-600', className)}>{label}</Badge>
    )
  }
  if (level === 1) {
    return <Badge variant="secondary" className={className}>{label}</Badge>
  }
  return <Badge variant="outline" className={cn('text-muted-foreground', className)}>{label}</Badge>
}
