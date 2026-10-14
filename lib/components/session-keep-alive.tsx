'use client'

import { useEffect } from 'react'

import { refreshAuthSession } from '@/lib/client'

// How often an open tab re-checks the session. better-auth only extends a
// session once per `updateAge` (a day by default), so checking more often buys
// nothing; checking at all is what keeps a long-lived tab's cookie from lapsing.
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000

/**
 * Keeps the browser's session cookie in step with the database session.
 *
 * Mounted once in the signed-in layout. It renders nothing: it calls
 * better-auth's `/get-session` on mount, then at most once per
 * `SESSION_REFRESH_INTERVAL_MS` while the tab is visible — on a timer, so a tab
 * that is never hidden still refreshes, and when the tab becomes visible again.
 * Server renders cannot refresh the session (they cannot write the cookie); see
 * `refreshAuthSession`.
 */
export const SessionKeepAlive = () => {
  useEffect(() => {
    let lastRefreshAt = 0
    let isRefreshing = false

    const runRefresh = async () => {
      if (isRefreshing) return
      isRefreshing = true
      try {
        const ok = await refreshAuthSession()
        if (ok) {
          lastRefreshAt = Date.now()
        }
      } finally {
        isRefreshing = false
      }
    }

    const refreshIfDue = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefreshAt < SESSION_REFRESH_INTERVAL_MS) return
      void runRefresh()
    }

    void runRefresh()

    const interval = window.setInterval(
      refreshIfDue,
      SESSION_REFRESH_INTERVAL_MS
    )
    document.addEventListener('visibilitychange', refreshIfDue)
    window.addEventListener('online', refreshIfDue)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfDue)
      window.removeEventListener('online', refreshIfDue)
    }
  }, [])

  return null
}
