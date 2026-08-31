// Tiny client-side API helper. All URLs are relative (sandbox gateway rule).
//
// Auth note: the preview panel renders the app inside a cross-origin iframe,
// where browsers drop SameSite=Lax session cookies (third-party cookie
// blocking). To stay signed in everywhere, login/register return a bearer
// token that we persist and attach to every request. The httpOnly cookie
// remains in place as a first-party fallback; the server accepts either.

const TOKEN_KEY = 'ek_token'

let memoryToken: string | null = null

function safeLocalGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  }
}

function safeLocalSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // Storage unavailable (hardened iframe) — keep token in memory only.
    }
  }
}

function safeLocalRemove(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken
  return safeLocalGet(TOKEN_KEY)
}

export function setToken(token: string | null) {
  memoryToken = token
  if (token) safeLocalSet(TOKEN_KEY, token)
  else safeLocalRemove(TOKEN_KEY)
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data?.error) return data.error
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as T
}

export const api = {
  get: <T>(url: string) => apiFetch<T>(url),
  post: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  upload: async (file: File): Promise<{ url: string }> => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<{ url: string }>('/api/upload', { method: 'POST', body: form })
  },
}

/** Global nudge so header badges etc. refetch after mutations. */
export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent('ek:refresh'))
}

export function onDataChanged(cb: () => void) {
  window.addEventListener('ek:refresh', cb)
  return () => window.removeEventListener('ek:refresh', cb)
}
