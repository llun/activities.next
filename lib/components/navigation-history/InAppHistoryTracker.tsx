'use client'

import { usePathname } from 'next/navigation'
import { useLayoutEffect } from 'react'

import { recordNavigation } from './inAppHistory'

/**
 * Records every pathname this tab renders so `useInAppBack` can tell an in-app
 * Back from a direct entry. Mounted once in the root layout, so it spans every
 * route group; renders nothing.
 */
export function InAppHistoryTracker() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    if (pathname) recordNavigation(pathname)
  }, [pathname])

  return null
}
