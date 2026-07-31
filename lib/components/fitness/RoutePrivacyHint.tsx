import { FC, useLayoutEffect, useRef, useState } from 'react'

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

/** Gap between the pointer and the chip's nearest edge. */
const HINT_POINTER_GAP_PX = 12
/** Smallest gap kept between the chip and the map's own edge. */
const HINT_EDGE_MARGIN_PX = 6

/** Pointer position the hint is anchored to, in map-container pixels. */
export interface RoutePrivacyHintPoint {
  x: number
  y: number
}

export interface RoutePrivacyHintSize {
  width: number
  height: number
}

/**
 * Whether this device can hover at all.
 *
 * Both renderers surface the hint on a tap as well as a hover, and a tap has no
 * pointer-leave to close it, so it retires on a timer. But the underlying
 * events (`click`, MapKit's `single-tap`) fire for a mouse press too — so on a
 * pointer device that timer would yank the hint away four seconds into a hover
 * the user is still holding. Where hover exists, leave governs and the timer is
 * not armed at all.
 */
export const isHoverCapablePointer = (): boolean => {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: hover)').matches
}

/**
 * Place the chip near the pointer but wholly inside the map.
 *
 * The map panel is `overflow-hidden`, so anything that overruns its box is not
 * merely ugly, it is invisible — and the interesting hover is often at an edge,
 * because the hidden stretches are precisely the trimmed start and finish of
 * the route, which `fitBounds` parks near the bounding box's rim. The chip
 * therefore prefers to sit above the pointer, flips below when there is no room
 * above, and is clamped horizontally so a hover near the left or right edge
 * does not slice the text off. Mirrors what `ChartHoverMarker` does for the
 * analysis charts.
 */
export const getRoutePrivacyHintPlacement = (
  point: RoutePrivacyHintPoint,
  chip: RoutePrivacyHintSize,
  container: RoutePrivacyHintSize
): { left: number; top: number } => {
  const maxLeft = container.width - chip.width - HINT_EDGE_MARGIN_PX
  const left =
    maxLeft <= HINT_EDGE_MARGIN_PX
      ? // Chip is wider than the map: pin it left rather than centre it, so the
        // sentence reads from its start instead of losing both ends.
        HINT_EDGE_MARGIN_PX
      : Math.min(
          Math.max(point.x - chip.width / 2, HINT_EDGE_MARGIN_PX),
          maxLeft
        )

  const above = point.y - chip.height - HINT_POINTER_GAP_PX
  const below = point.y + HINT_POINTER_GAP_PX
  const maxTop = container.height - chip.height - HINT_EDGE_MARGIN_PX
  const top =
    above >= HINT_EDGE_MARGIN_PX
      ? above
      : Math.min(Math.max(below, HINT_EDGE_MARGIN_PX), Math.max(maxTop, 0))

  return { left, top }
}

interface Props {
  /** Anchor point, or null when nothing is hovered/tapped. */
  point: RoutePrivacyHintPoint | null
  /**
   * The map's own box, used to keep the chip inside it. Omitted only when the
   * caller cannot measure it; the chip then falls back to sitting above the
   * pointer, which is right everywhere except at an edge.
   */
  containerSize?: RoutePrivacyHintSize | null
}

/**
 * The floating chip. Follows the house recipe for a readout over a map or chart
 * (`ChartHoverMarker`, the map provider badges): absolutely positioned by inline
 * style, `pointer-events-none` so it can never swallow a map gesture, and
 * `aria-hidden` because it is a visual echo of `RoutePrivacyDescription`, which
 * carries the same information to assistive technology unconditionally.
 */
export const RoutePrivacyHint: FC<Props> = ({ point, containerSize }) => {
  const chipRef = useRef<HTMLDivElement | null>(null)
  const [chipSize, setChipSize] = useState<RoutePrivacyHintSize | null>(null)

  // Measured rather than assumed: the copy's rendered width depends on the
  // viewer's font. Runs before paint, so the clamped position is the first one
  // drawn. Fixed copy means one measurement is enough.
  useLayoutEffect(() => {
    const element = chipRef.current
    if (!element) return
    if (element.offsetWidth === 0 && element.offsetHeight === 0) return
    setChipSize((current) =>
      current?.width === element.offsetWidth &&
      current?.height === element.offsetHeight
        ? current
        : { width: element.offsetWidth, height: element.offsetHeight }
    )
  }, [point])

  if (!point) return null

  const placement =
    chipSize && containerSize
      ? getRoutePrivacyHintPlacement(point, chipSize, containerSize)
      : null

  return (
    <div
      ref={chipRef}
      aria-hidden="true"
      data-testid="route-privacy-hint"
      className={cn(
        'pointer-events-none absolute z-20 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium shadow-sm',
        'border-green-300 bg-background/95 text-green-700 dark:border-green-900 dark:text-green-400'
      )}
      style={
        placement
          ? { left: `${placement.left}px`, top: `${placement.top}px` }
          : {
              // Pre-measurement fallback: above the pointer, so the chip never
              // covers the segment being asked about.
              left: `${point.x}px`,
              top: `${point.y}px`,
              transform: `translate(-50%, calc(-100% - ${HINT_POINTER_GAP_PX}px))`
            }
      }
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
