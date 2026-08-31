// Tiny client-side API helper. All URLs are relative (sandbox gateway rule).

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
  const res = await fetch(url, init)
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
