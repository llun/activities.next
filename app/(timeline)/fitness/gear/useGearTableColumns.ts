'use client'

import {
  CSSProperties,
  RefCallback,
  useEffect,
  useLayoutEffect,
  useState
} from 'react'

/**
 * Below this the gear tables stop laying their data columns out side by side.
 * Each one instead takes the whole width the pinned first column leaves over
 * and becomes a scroll-snap panel, so a swipe moves exactly one column into
 * view — the alternative on a phone is a table wide enough that every column is
 * half-legible and the row it belongs to has scrolled off the left edge.
 */
export const GEAR_TABLE_SNAP_WIDTH = 480

/**
 * A snapped data column never gets narrower than this even on a very small
 * screen: "35,670.2 km" plus its wear bar has to fit on one line.
 */
const MIN_SNAP_COLUMN_WIDTH = 160

// The measurement has to land before the browser paints, or the table renders
// wide for a frame and then reflows. `useLayoutEffect` warns when React renders
// on the server, where there is nothing to measure anyway.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface GearTableColumns {
  /**
   * Attach to the scrolling wrapper — it is what gets measured. A callback ref
   * rather than a ref object, because the wrapper is conditional: a bike with
   * nothing installed renders the empty state instead, and a ref object set
   * later re-runs no effect, so the observer would never attach to the table
   * that appears when the first component is added.
   */
  ref: RefCallback<HTMLDivElement>
  isSnapping: boolean
  /** Widths for the pinned first column's `th`/`td`. */
  pinnedColumnStyle: CSSProperties
  /**
   * Widths for one data column. `minWidth` only applies off the snap path,
   * where the columns share the row; pass the width the cell's longest
   * realistic value needs.
   */
  dataColumnStyle: (minWidth?: number) => CSSProperties
  /** Scroll-snap settings for the wrapper; undefined when not snapping. */
  scrollerStyle: CSSProperties | undefined
}

/**
 * Responsive column behavior shared by every gear table: the first column is
 * pinned to the left edge so a row always says what it is about, and below
 * `GEAR_TABLE_SNAP_WIDTH` the data columns become one-per-swipe snap panels.
 *
 * It measures the table's own scroll container rather than the viewport, for
 * the same reason `useCompactActionBar` does — a table can sit in a narrow
 * column on a wide window, and a viewport breakpoint would snap the wrong ones.
 *
 * Reports "not snapping" wherever `ResizeObserver` is missing (server render,
 * jsdom): the full table is the honest default, and the first client layout
 * corrects it.
 */
export const useGearTableColumns = (
  pinnedColumnWidth: number
): GearTableColumns => {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useIsomorphicLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return

    // A zero width means the table was never laid out — a `display: none`
    // ancestor, a detached subtree, jsdom — not that it is narrow, and snapping
    // on it would fix every column at the 160px floor.
    const measure = (measured: number) => {
      if (measured === 0) return
      setWidth(measured)
    }

    // Measure here rather than leaving it to the observer's first delivery,
    // which lands after the frame has painted — one flash of the wide table on
    // every phone.
    measure(element.clientWidth)

    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  const isSnapping = width > 0 && width < GEAR_TABLE_SNAP_WIDTH
  const columnWidth = Math.max(MIN_SNAP_COLUMN_WIDTH, width - pinnedColumnWidth)

  return {
    ref: setElement,
    isSnapping,
    pinnedColumnStyle: {
      minWidth: pinnedColumnWidth,
      ...(isSnapping
        ? { width: pinnedColumnWidth, maxWidth: pinnedColumnWidth }
        : null)
    },
    dataColumnStyle: (minWidth?: number) =>
      isSnapping
        ? {
            width: columnWidth,
            minWidth: columnWidth,
            maxWidth: columnWidth,
            scrollSnapAlign: 'start',
            // A snapped column fills the row, so its value belongs on the edge
            // the swipe brings it to rather than floating in the middle.
            textAlign: 'right'
          }
        : { minWidth },
    // `scrollPaddingLeft` keeps the snap position clear of the pinned column,
    // which would otherwise cover the left edge of whatever just snapped in.
    scrollerStyle: isSnapping
      ? { scrollSnapType: 'x mandatory', scrollPaddingLeft: pinnedColumnWidth }
      : undefined
  }
}
