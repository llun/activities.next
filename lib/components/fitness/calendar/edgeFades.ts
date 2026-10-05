/**
 * The annual calendar's horizontal scroll affordances, as pure functions: which
 * edge fades to show, and the constants the sticky labels, the fade and the
 * snap padding are all derived from.
 */
import { ANNUAL_LABEL_WIDTH } from '@/lib/fitness/calendar/geometry'

/** Width of an edge fade. */
export const EDGE_FADE_WIDTH = 16

/**
 * `scroll-padding-inline-start` of the annual scroller: the sticky label column
 * plus the fade. A snapped month column therefore lands clear of both and is
 * always fully opaque.
 */
export const ANNUAL_SNAP_PADDING = ANNUAL_LABEL_WIDTH + EDGE_FADE_WIDTH

/** Sub-pixel scroll positions are not "scrolled": ignore under this. */
const EDGE_EPSILON = 1

export interface ScrollMetrics {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

export interface EdgeFades {
  /** Content is hidden past the start edge: show the start fade. */
  start: boolean
  /** Content is hidden past the end edge: show the end fade. */
  end: boolean
}

/**
 * Which fades to draw. A fade only appears on a side that has hidden content:
 * none when everything fits, no start fade at scroll position 0, and no end
 * fade once the end is reached, so the fade is never over today at the end of
 * the grid.
 */
export const edgeFades = ({
  scrollLeft,
  clientWidth,
  scrollWidth
}: ScrollMetrics): EdgeFades => {
  const maxScroll = scrollWidth - clientWidth
  if (!(maxScroll > EDGE_EPSILON)) return { start: false, end: false }
  return {
    start: scrollLeft > EDGE_EPSILON,
    end: scrollLeft < maxScroll - EDGE_EPSILON
  }
}

export const sameEdgeFades = (a: EdgeFades, b: EdgeFades): boolean =>
  a.start === b.start && a.end === b.end
