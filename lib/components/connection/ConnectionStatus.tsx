'use client'

import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { probeNow } from '@/lib/client/connection'
import {
  type SlotMessage,
  getSlotMessage
} from '@/lib/components/connection/slotMessage'
import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { cn } from '@/lib/utils'

// The host the browser is trying to reach. It only matters once the state is
// not online, so the server render (always online) never needs it.
const getConnectionHost = () =>
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

// What the bar and the strip show: the shared message, plus the home-only
// "Showing saved posts" under "You're offline." (the home feed is the one page
// that renders from the offline cache). The announcer takes the title alone.
// Re-renders every second while a countdown is showing, so it stays current.
const useSlotMessage = (): SlotMessage | null => {
  const snapshot = useConnectionStatus()
  const isHome = usePathname() === '/'
  // `now` is state, not a `Date.now()` read inside `getSlotMessage`: the React
  // Compiler caches that call on its (unchanged) arguments, so the countdown
  // would never move. It ticks only while a countdown is showing.
  const counting =
    snapshot.state === 'unreachable' && snapshot.nextProbeAt !== null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!counting) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [counting])

  const message = getSlotMessage(snapshot, getConnectionHost(), now)
  if (message?.kind === 'offline' && isHome) {
    return { ...message, detail: 'Showing saved posts' }
  }
  return message
}

const ICONS = { offline: WifiOff, unreachable: AlertTriangle } as const

// The countdown ticks every second, so a screen reader never gets it: the
// announcer already says the title once.
const Detail = ({ message }: { message: SlotMessage }) => (
  <span
    aria-hidden={message.kind === 'unreachable' ? true : undefined}
    className="tabular-nums"
  >
    {message.detail}
  </span>
)

function RetryButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void probeNow()}
    >
      <RefreshCw aria-hidden="true" />
      Retry
    </Button>
  )
}

/**
 * Desktop: the full-width alert at the top of the content column. Purely
 * visual (`live={false}`): `ConnectionAnnouncer` is the one live region, so
 * this and the strip never announce twice.
 */
export function ConnectionStatusBar() {
  const message = useSlotMessage()
  if (!message) return null
  return (
    <Alert
      tone="info"
      live={false}
      icon={ICONS[message.kind]}
      title={message.title}
      action={message.retry ? <RetryButton /> : undefined}
      className="mt-4 max-md:hidden"
    >
      {message.detail ? <Detail message={message} /> : null}
    </Alert>
  )
}

// The strip wraps taller than its 52px minimum (a long host, a large font), so
// its real height goes in `--status-strip-h` while it shows; globals.css keeps
// 52px as the fallback until the first measurement.
const trackStripHeight = (strip: HTMLDivElement | null) => {
  if (!strip || typeof ResizeObserver === 'undefined') return
  const root = document.documentElement
  const observer = new ResizeObserver(() => {
    const height = strip.getBoundingClientRect().height
    // Zero while `md:hidden`: leave the variable to the stylesheet.
    if (height > 0) root.style.setProperty('--status-strip-h', `${height}px`)
    else root.style.removeProperty('--status-strip-h')
  })
  observer.observe(strip)
  return () => {
    observer.disconnect()
    root.style.removeProperty('--status-strip-h')
  }
}

/**
 * Phone: the strip sticky under the compact bar (56px plus the top safe area).
 * `data-connection-strip` is what globals.css keys `--status-strip-h` on, so
 * scroll padding and the new-posts pill clear it.
 */
export function ConnectionStatusStrip() {
  const message = useSlotMessage()
  if (!message) return null
  const Icon = ICONS[message.kind]
  return (
    <div
      ref={trackStripHeight}
      data-connection-strip=""
      className={cn(
        'sticky top-[calc(56px+env(safe-area-inset-top,0px))] z-30 md:hidden',
        // A sibling of the compact header: no `space-y-*` gap under it.
        'mb-0 flex min-h-[52px] items-center gap-3 border-b bg-info-surface px-4'
      )}
      style={breakoutStyle}
    >
      <Icon className="size-4 shrink-0 text-info-text" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold break-words">{message.title}</p>
        {message.detail ? (
          <p className="text-xs text-muted-foreground break-words">
            <Detail message={message} />
          </p>
        ) : null}
      </div>
      {message.retry ? <RetryButton className="shrink-0" /> : null}
    </div>
  )
}
