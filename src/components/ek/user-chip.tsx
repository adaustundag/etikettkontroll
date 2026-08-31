'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { TrustBadge } from '@/components/ek/trust-badge'
import { initials, navigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { PublicUser } from '@/lib/types'

export function UserChip({
  user,
  showTrust = true,
  className,
  onNavigate,
}: {
  user: PublicUser
  showTrust?: boolean
  className?: string
  onNavigate?: (path: string) => void
}) {
  const go = onNavigate ?? ((p: string) => navigate(p))
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        go(`profile/${user.id}`)
      }}
      className={cn('group inline-flex min-w-0 items-center gap-2 rounded-full text-left', className)}
      aria-label={`Profile: ${user.name}`}
    >
      <Avatar className="h-6 w-6">
        <AvatarFallback className="text-[10px] bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          {initials(user.name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-sm font-medium group-hover:underline">{user.name}</span>
      {showTrust && <TrustBadge level={user.trustLevel} label={user.trustLabel} className="hidden sm:inline-flex" />}
    </button>
  )
}
