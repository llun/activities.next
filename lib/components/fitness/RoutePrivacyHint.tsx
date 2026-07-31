import { FC } from 'react'

import { cn } from '@/lib/utils'

/**
 * Why part of an activity's own route is drawn in green: a privacy location
 * trims the start/finish, and those trimmed stretches are shown to the owner
 * but never served to anyone else.
 *
 * This used to be a dismissible bar pinned to the map's bottom-left corner,
 * which meant the explanation sat on top of the map it was explaining. It is
 * now attached to the green line itself — hover it on a pointer device, tap it
 * on a touch one — so the map is never covered and the answer appears exactly
 * where the question does.
 */
export const ROUTE_PRIVACY_HINT_LABEL = 'Hidden from other viewers'

/** Pointer distance, in pixels, that still counts as "on" a green segment. */
export const ROUTE_PRIVACY_HINT_TOLERANCE_PX = 12

/**
 * How long a tap-opened hint stays up. Touch has no pointer-leave, so the hint
 * has to retire itself; a pointer hover clears on leave and never uses this.
 */
export const ROUTE_PRIVACY_HINT_TAP_TIMEOUT_MS = 4000

/** Pointer position the hint is anchored to, in map-container pixels. */
export interface RoutePrivacyHintPoint {
  x: number
  y: number
}

interface Props {
  /** Anchor point, or null when nothing is hovered/tapped. */
  point: RoutePrivacyHintPoint | null
}

/**
 * The floating chip. Follows the house recipe for a readout over a map or chart
 * (`ChartHoverMarker`, the map provider badges): absolutely positioned by inline
 * style, `pointer-events-none` so it can never swallow a map gesture, and
 * `aria-hidden` because it is a visual echo of `RoutePrivacyDescription`, which
 * carries the same information to assistive technology unconditionally.
 */
export const RoutePrivacyHint: FC<Props> = ({ point }) => {
  if (!point) return null

  return (
    <div
      aria-hidden="true"
      data-testid="route-privacy-hint"
      className={cn(
        'pointer-events-none absolute z-20 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium shadow-sm',
        'border-green-300 bg-background/95 text-green-700 dark:border-green-900 dark:text-green-400'
      )}
      style={{
        left: `${point.x}px`,
        top: `${point.y}px`,
        // Sits above the pointer so it never covers the segment being asked
        // about — the one thing the old bottom-left bar got wrong.
        transform: 'translate(-50%, calc(-100% - 12px))'
      }}
    >
      {ROUTE_PRIVACY_HINT_LABEL}
    </div>
  )
}

/**
 * The non-visual half. A hover/tap affordance is unreachable by keyboard and
 * invisible to a screen reader, so the explanation is also stated outright
 * whenever the route has hidden segments. This is what the dismissible bar used
 * to provide incidentally by being a focusable button.
 */
export const RoutePrivacyDescription: FC<{ hasHiddenSegments: boolean }> = ({
  hasHiddenSegments
}) => {
  if (!hasHiddenSegments) return null

  return (
    <p className="sr-only">
      Part of this route is hidden from other viewers by a privacy location. The
      hidden sections are drawn in green and are visible only to you.
    </p>
  )
}
