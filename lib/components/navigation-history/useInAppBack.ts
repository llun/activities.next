'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useSyncExternalStore } from 'react'

import { hasInAppPrevious, subscribeToInAppHistory } from './inAppHistory'

/**
 * `canGoBack` is true when `router.back()` would return to a page this tab
 * visited inside the app. The server snapshot is `false`, so a hard load —
 * which is exactly a direct entry — renders the fallback on the server and on
 * the hydrating client alike.
 */
export const useInAppBack = () => {
  const pathname = usePathname()
  const router = useRouter()
  const canGoBack = useSyncExternalStore(
    subscribeToInAppHistory,
    () => hasInAppPrevious(pathname ?? ''),
    () => false
  )
  const goBack = useCallback(() => router.back(), [router])
  return { canGoBack, goBack }
}
