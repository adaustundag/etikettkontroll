'use client'

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { navigate } from '@/lib/router'

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children: ReactNode
}

/**
 * A real <a href> (crawlable, middle-click/cmd-click opens new tab) that
 * intercepts plain left-clicks and performs SPA navigation without a full
 * page reload.
 */
export function AppLink({ href, onClick, children, ...rest }: AppLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }
  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}
