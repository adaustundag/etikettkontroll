'use client'

// React bindings + formatting helpers on top of the pure router (src/lib/route.ts).

import { useEffect, useSyncExternalStore } from 'react'
import { currentRoute, parsePath, subscribe } from './route'

export { navigate, parsePath, type Route, type RouteView } from './route'

/**
 * Repair legacy "#/..." URLs once the document has settled. Running this after
 * hydration (not at module scope) avoids the browser re-applying the initial
 * fragment over an early history.replaceState.
 */
function useLegacyHashCleanup(): void {
  useEffect(() => {
    const repair = () => {
      const hash = window.location.hash
      if (hash.startsWith('#/')) {
        try {
          window.history.replaceState(null, '', hash.slice(1) || '/')
        } catch {
          // ignore
        }
      }
    }
    // Wait until the initial load (incl. any pending fragment navigation) has
    // settled, then keep repairing in case a legacy link lands later.
    if (document.readyState === 'complete') {
      repair()
    } else {
      window.addEventListener('load', repair, { once: true })
    }
    window.addEventListener('hashchange', repair)
    return () => {
      window.removeEventListener('load', repair)
      window.removeEventListener('hashchange', repair)
    }
  }, [])
}

const SSR_ROUTE: Route = { view: 'home', param: '' }

// getSnapshot must be referentially stable between calls — cache by URL.
let lastUrl = ''
let lastRoute: Route = { view: 'home', param: '' }
let haveRoute = false
function cachedRoute(): Route {
  const url = window.location.pathname + window.location.hash
  if (!haveRoute || url !== lastUrl) {
    lastUrl = url
    lastRoute = currentRoute()
    haveRoute = true
  }
  return lastRoute
}

/**
 * Subscribe to the current route. On the server (and during hydration) the
 * `initialRoute` computed by the catch-all page is used, so deep links render
 * the correct view in SSR HTML without a flash of home content.
 */
export function useRoute(initialRoute?: Route): Route {
  useLegacyHashCleanup()
  return useSyncExternalStore(
    subscribe,
    cachedRoute,
    initialRoute ? () => initialRoute : () => SSR_ROUTE,
  )
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
