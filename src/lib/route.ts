// Pure SPA routing primitives — NO React imports here.
// This module is imported by both server components (catch-all page) and
// client code, so it must stay free of client-only APIs at module scope.
// Browser-specific calls are guarded with typeof window.

export type RouteView = 'home' | 'product' | 'submit' | 'queue' | 'profile'
export type Route = { view: RouteView; param: string }

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export function parsePath(pathname: string): Route {
  const clean = pathname.replace(/^\/+|\/+$/g, '')
  const [viewRaw, param = ''] = clean.split('/')
  switch (viewRaw) {
    case 'product':
      return { view: 'product', param: safeDecode(param) }
    case 'submit':
      return { view: 'submit', param: safeDecode(param) }
    case 'queue':
      return { view: 'queue', param: '' }
    case 'profile':
      return { view: 'profile', param: safeDecode(param) }
    default:
      return { view: 'home', param: '' }
  }
}

// --- legacy "#/..." links -----------------------------------------------------
// Old shared links look like https://host/#/product/123. Browsers can override
// an early history.replaceState by completing the initial fragment navigation,
// so we do NOT rewrite the URL at module scope. Instead the route is derived
// from the hash first (view is instantly correct) and the URL is repaired once
// the document has settled — see useLegacyHashCleanup in src/lib/router.ts.

/**
 * Current route from the live URL. Legacy "#/..." fragments take precedence
 * over the pathname so old links resolve to the right view immediately.
 */
export function currentRoute(): Route {
  if (typeof window === 'undefined') return { view: 'home', param: '' }
  const legacy = window.location.hash
  if (legacy.startsWith('#/')) {
    return parsePath(legacy.slice(1) || '/')
  }
  return parsePath(window.location.pathname)
}

// --- navigation ----------------------------------------------------------------
type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(onChange: Listener): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

/**
 * SPA navigation via the History API. Accepts the same relative form the old
 * hash router used ("", "queue", "product/123") or absolute ("/queue").
 */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  const target = path.startsWith('/') ? path : `/${path.replace(/^\/+/, '')}`
  if (window.location.pathname === target) {
    window.scrollTo({ top: 0 })
    return
  }
  window.history.pushState(null, '', target)
  window.scrollTo({ top: 0 })
  emit()
}
