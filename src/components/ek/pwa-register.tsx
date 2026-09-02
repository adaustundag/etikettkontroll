'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js in production only. In development we actively unregister
 * any service worker that might linger from a previous production build on
 * the same origin — a cached shell under `next dev` (HMR, schema changes,
 * port churn) is pure misery.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => {})
      return
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
