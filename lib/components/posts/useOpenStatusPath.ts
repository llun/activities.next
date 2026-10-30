'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext } from 'react'

// Provided by `PendingProfileNavigationProvider` (`app/(timeline)`), which
// navigates and reports the navigation as pending. Posts also render outside
// the `(timeline)` layout, where there is no provider.
export const OpenStatusPathContext = createContext<
  ((path: string) => void) | null
>(null)

/**
 * Opens a status detail page. Inside the `(timeline)` layout a slow
 * navigation (see `PENDING_STATUS_DELAY_MS`) gets a delayed skeleton; without
 * a provider this is a plain `router.push`.
 */
export const useOpenStatusPath = (): ((path: string) => void) => {
  const router = useRouter()
  const open = useContext(OpenStatusPathContext)
  const push = useCallback((path: string) => router.push(path), [router])
  return open ?? push
}
