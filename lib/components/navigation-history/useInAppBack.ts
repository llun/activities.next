'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useSyncExternalStore } from 'react'

import { getInAppPrevious, subscribeToInAppHistory } from './inAppHistory'

/**
 * `previousPathname` is the in-app page `router.back()` would return to, and
 * `canGoBack` whether there is one. The server snapshot is `null`, so a hard
 * load — which is exactly a direct entry — renders the fallback on the server
 * and on the hydrating client alike; the recorded page only takes over after
 * hydration.
 */
export const useInAppBack = () => {
  const pathname = usePathname()
  const router = useRouter()
  const previousPathname = useSyncExternalStore(
    subscribeToInAppHistory,
    () => getInAppPrevious(pathname ?? ''),
    () => null
  )
  const goBack = useCallback(() => router.back(), [router])
  return { canGoBack: previousPathname !== null, previousPathname, goBack }
}
