'use client'

import { useEffect } from 'react'

import { refreshAuthSession } from '@/lib/client'

// How often a tab that stays open may re-check the session when it comes back
// into view. better-auth only extends a session once per `updateAge` (a day by
// default), so checking more often buys nothing; checking at all is what keeps
// a long-lived tab's cookie from lapsing.
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000

/**
 * Keeps the browser's session cookie in step with the database session.
 *
 * Mounted once in the signed-in layout. It renders nothing: on mount, and
 * whenever the tab becomes visible again after `SESSION_REFRESH_INTERVAL_MS`,
 * it calls better-auth's `/get-session`, the only session read that can re-issue
 * the cookie. See `refreshAuthSession` for why the server render cannot.
 */
export const SessionKeepAlive = () => {
  useEffect(() => {
    let lastRefreshAt = Date.now()
    refreshAuthSession()

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefreshAt < SESSION_REFRESH_INTERVAL_MS) return
      lastRefreshAt = Date.now()
      refreshAuthSession()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
