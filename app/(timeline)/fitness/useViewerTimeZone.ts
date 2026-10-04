'use client'

import { useSyncExternalStore } from 'react'

import {
  canonicalTimeZone,
  isNamedTimeZone
} from '@/lib/fitness/calendar/localDay'

/** The zone the overview falls back to when the browser reports none it can use. */
export const FALLBACK_TIME_ZONE = 'UTC'

/**
 * The browser's IANA zone in its canonical spelling, or `UTC` when the browser
 * reports nothing usable (an empty string, `Etc/Unknown`, an offset form).
 */
export const readViewerTimeZone = (): string => {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    // Named zones only, the form the fitness routes accept.
    if (zone && isNamedTimeZone(zone)) {
      return canonicalTimeZone(zone)
    }
  } catch {
    // An engine without zone support has nothing better to offer.
  }
  return FALLBACK_TIME_ZONE
}

// A traveller's zone can change while the tab sleeps; the browser fires no
// event for it, so re-read when the page comes back into view.
const subscribe = (onChange: () => void) => {
  window.addEventListener('focus', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    window.removeEventListener('focus', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

const getServerSnapshot = () => null

/**
 * The viewer's IANA time zone, or `null` while it is unknown: on the server and
 * during hydration, where the server's HTML has to be repeated exactly. The
 * fitness overview renders a structural skeleton for `null`, so no date that
 * depends on the zone is ever rendered by the server and replaced on the
 * client (a hydration mismatch), and the first client render after hydration
 * switches to the viewer's own days.
 */
export const useViewerTimeZone = (): string | null =>
  useSyncExternalStore(subscribe, readViewerTimeZone, getServerSnapshot)
