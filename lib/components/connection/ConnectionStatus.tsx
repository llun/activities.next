'use client'

import {
  AlertTriangle,
  ListChecks,
  LoaderCircle,
  type LucideIcon,
  RefreshCw,
  WifiOff
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { probeNow } from '@/lib/client/connection'
import {
  type SlotMessage,
  getSlotMessage
} from '@/lib/components/connection/slotMessage'
import { useSendQueueStatus } from '@/lib/components/drafts/DraftsProvider'
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
  const queue = useSendQueueStatus()
  const message = getSlotMessage(
    snapshot,
    getConnectionHost(),
    undefined,
    queue
  )
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
  const queue = useSendQueueStatus()
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

  const message = getSlotMessage(snapshot, getConnectionHost(), now, queue)
  if (message?.kind === 'offline' && isHome) {
    return { ...message, detail: 'Showing saved posts' }
  }
  return message
}

// The sending spinner stops for people who ask for less motion.
const SpinningLoader = ((props) => (
  <LoaderCircle
    {...props}
    className={cn(props.className, 'motion-safe:animate-spin')}
  />
)) as LucideIcon

const ICONS = {
  offline: WifiOff,
  unreachable: AlertTriangle,
  sending: SpinningLoader,
  result: ListChecks
} as const

// A failure stops the spinner: nothing is progressing as it was.
const iconOf = (message: SlotMessage) =>
  message.tone === 'error' ? AlertTriangle : ICONS[message.kind]

// The countdown and the "Sending 2 of 5" count change while the title stays
// put, so a screen reader never gets them: the announcer says the title once.
const Detail = ({ message }: { message: SlotMessage }) => (
  <span
    aria-hidden={
      message.kind === 'unreachable' || message.kind === 'sending'
        ? true
        : undefined
    }
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

function QueueLink({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href="/drafts">{label}</Link>
    </Button>
  )
}

/** Retry for a connection message; Pause and Review or View for the queue's. */
function SlotActions({
  message,
  className
}: {
  message: SlotMessage
  className?: string
}) {
  const queue = useSendQueueStatus()
  if (message.retry) return <RetryButton className={className} />
  if (message.kind === 'sending') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // A failed pause leaves the queue running and says so in the
          // title; pressing Pause again retries it.
          onClick={() => void queue?.pause()}
        >
          Pause
        </Button>
        <QueueLink label="Review" />
      </div>
    )
  }
  if (message.kind === 'result') {
    return (
      <div className={className}>
        <QueueLink label="View" />
      </div>
    )
  }
  return null
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
      tone={message.tone ?? 'info'}
      live={false}
      icon={iconOf(message)}
      title={message.title}
      action={<SlotActions message={message} />}
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
export function ConnectionStatusStrip({ className }: { className?: string }) {
  const message = useSlotMessage()
  if (!message) return null
  const Icon = iconOf(message)
  const error = message.tone === 'error'
  return (
    <div
      ref={trackStripHeight}
      data-connection-strip=""
      className={cn(
        'sticky top-[calc(56px+env(safe-area-inset-top,0px))] z-30 md:hidden',
        'flex min-h-[52px] items-center gap-3 border-b px-4',
        error ? 'bg-destructive-surface' : 'bg-info-surface',
        // The compact header's spacing: it continues the bar.
        className
      )}
      style={breakoutStyle}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          error ? 'text-destructive-text' : 'text-info-text'
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold break-words">{message.title}</p>
        {message.detail ? (
          <p className="text-xs text-muted-foreground break-words">
            <Detail message={message} />
          </p>
        ) : null}
      </div>
      <SlotActions message={message} className="shrink-0" />
    </div>
  )
}
