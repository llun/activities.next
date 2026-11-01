'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Keep the optional chain: the production build removed a plain
    // `!navigator.serviceWorker` guard, and WKWebViews have no serviceWorker.
    navigator.serviceWorker
      ?.register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.update().catch(() => {})
      })
      .catch(() => {})
  }, [])

  return null
}
