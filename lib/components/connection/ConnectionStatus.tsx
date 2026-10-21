'use client'

import { getSlotMessage } from '@/lib/components/connection/slotMessage'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'

// The host the browser is trying to reach. It only matters once the state is
// not online, so the server render (always online) never needs it.
export const getConnectionHost = () =>
  typeof window === 'undefined' ? '' : window.location.host

/**
 * The one live region for the whole page, mounted once in the layout. It
 * carries the title only: the bar and the strip are purely visual (they render
 * nothing while online), and a ticking countdown is never announced.
 */
export function ConnectionAnnouncer() {
  const snapshot = useConnectionStatus()
  const message = getSlotMessage(snapshot, getConnectionHost())
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message?.title}
    </div>
  )
}

/** Desktop: the full-width alert above the content column. Not built yet. */
export function ConnectionStatusBar() {
  return null
}

/** Phone: the sticky strip under the compact bar. Not built yet. */
export function ConnectionStatusStrip() {
  return null
}
