'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type RouteView = 'home' | 'product' | 'submit' | 'queue' | 'profile'
export type Route = { view: RouteView; param: string }

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [viewRaw, param = ''] = clean.split('/')
  switch (viewRaw) {
    case 'product':
      return { view: 'product', param: decodeURIComponent(param) }
    case 'submit':
      return { view: 'submit', param: decodeURIComponent(param) }
    case 'queue':
      return { view: 'queue', param: '' }
    case 'profile':
      return { view: 'profile', param: decodeURIComponent(param) }
    default:
      return { view: 'home', param: '' }
  }
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`
}

const SSR_ROUTE: Route = { view: 'home', param: '' }

// getSnapshot must be referentially stable between calls, so cache by hash string.
let lastHash = ''
let lastRoute: Route = SSR_ROUTE
function cachedRoute(): Route {
  const hash = window.location.hash
  if (hash !== lastHash) {
    lastHash = hash
    lastRoute = parseHash(hash)
  }
  return lastRoute
}

function subscribe(onChange: () => void) {
  const wrapped = () => {
    window.scrollTo({ top: 0 })
    onChange()
  }
  window.addEventListener('hashchange', wrapped)
  return () => window.removeEventListener('hashchange', wrapped)
}

export function useHashRoute(): Route {
  return useSyncExternalStore(subscribe, cachedRoute, () => SSR_ROUTE)
}

export function timeAgo(iso: string, lang: 'en' | 'sv'): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const minutes = Math.round(diffMs / 60000)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(-days, 'day')
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return rtf.format(-months, 'month')
  return rtf.format(-Math.round(months / 12), 'year')
}

export function formatDate(iso: string, lang: 'en' | 'sv'): string {
  return new Intl.DateTimeFormat(lang === 'sv' ? 'sv-SE' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso))
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
