'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect } from 'react'

import { recordNavigation, recordPop } from './inAppHistory'

/**
 * Records every pathname this tab renders so `useInAppBack` can tell an in-app
 * Back from a direct entry, and every `popstate` so it can tell a return to an
 * earlier page from a new visit to it. Mounted once in the root layout, so it
 * spans every route group; renders nothing.
 */
export function InAppHistoryTracker() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    if (pathname) recordNavigation(pathname)
  }, [pathname])

  useEffect(() => {
    // `popstate` fires after the URL has changed and before the router
    // renders the destination, so the stack is already popped when the page
    // reads it. The layout effect above then finds it recorded.
    const onPopState = () => recordPop(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return null
}
