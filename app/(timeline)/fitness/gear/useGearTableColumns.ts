'use client'

import {
  CSSProperties,
  RefCallback,
  useEffect,
  useLayoutEffect,
  useState
} from 'react'

/**
 * @deprecated Prefer dynamic whole-column snapping via `useGearTableColumns(pinnedWidth, options)`.
 * Kept as a reference constant for narrow mobile viewports (< 480px) where single-column swipe applies.
 */
export const GEAR_TABLE_SNAP_WIDTH = 480

/**
 * The width a snapped data column aims for when the pinned column leaves it
 * less — subject to `SNAP_OVERHANG_ALLOWANCE` below, which is what it actually
 * gets on a very narrow screen. The binding content is the distance cell's wear
 * line, measured at 158px — an 80px bar, an 8px gap and a caption as long as
 * "of 12,000 km" — plus the cell's own 24px of horizontal padding. Below that
 * the line is `whitespace-nowrap` inside a `justify-end` flex row, so it does
 * not clip: it spills out of the row's start edge and under the pinned column.
 */
const MIN_SNAP_COLUMN_WIDTH = 184

/**
 * How far the floor above may push a column past the scrollport's right edge.
 *
 * A floored column is wider than the space the pinned column leaves, so at rest
 * its right edge hangs off the scroller — and `scroll-snap-type: x mandatory`
 * means the reader cannot scroll to what hangs off. The cell's content is
 * `textAlign: 'right'`, so the overhang eats the *value* first, from the right:
 * the distance, the wear caption, the action button. That is the opposite of
 * what the floor is for.
 *
 * The cell's own `px-3` right padding is the only slack that can hang off
 * without taking a glyph with it, so the column is allowed exactly that much
 * overhang and no more. Past that point it keeps the same 12px rather than
 * dropping to the width available: the value then ends flush with the
 * scroller's edge — tight, but whole, and in the same place at every width —
 * while the wear line spills leftwards under the pinned column instead. That
 * spill is the degradation the floor's comment above already describes, and it
 * is plainly better than a distance nobody can scroll to.
 *
 * The band this covers is narrow but real — a 320px viewport (an SE, or any
 * phone in Display Zoom) leaves a 286px scroller, and with a 120px pin the
 * floored column hid 6px of "0.0 km".
 */
const SNAP_OVERHANG_ALLOWANCE = 12

// The measurement has to land before the browser paints, or the table renders
// wide for a frame and then reflows. `useLayoutEffect` warns when React renders
// on the server, where there is nothing to measure anyway.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface GearTableColumnsOptions {
  pinnedRightWidth?: number
  totalColumns?: number
  targetColumnWidth?: number
}

/** Default target column width used to compute how many whole columns fit. */
export const DEFAULT_TARGET_COLUMN_WIDTH = 180

/** Target column width when middle section is dual-pinned, calibrated to fit 4 middle columns on desktop. */
export const DEFAULT_TARGET_MIDDLE_COLUMN_WIDTH = 150

/** Default count of data columns in the components table. */
export const DEFAULT_TOTAL_DATA_COLUMNS = 7

/** Count of middle data columns between pinned Type and Actions. */
export const DEFAULT_TOTAL_MIDDLE_COLUMNS = 6

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
  /** Whether the middle section has overflowed to the left and can be scrolled back left. */
  canScrollLeft: boolean
  /** Whether the middle section has more overflow to the right and can be scrolled right. */
  canScrollRight: boolean
  /** Programmatically step by one column left or right with smooth scrolling. */
  scrollByColumn: (direction: 'left' | 'right') => void
  /** Widths for the pinned first column's `th`/`td`. */
  pinnedColumnStyle: CSSProperties
  /** Alias for pinnedColumnStyle for dual-pinned tables. */
  pinnedLeftStyle: CSSProperties
  /** Widths for the pinned right column's `th`/`td`. */
  pinnedRightStyle: CSSProperties
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
 * Responsive column behavior for gear tables: pins the subject column to
 * the left (and optionally the action column to the right) while the middle
 * data columns scroll with whole-column scroll snapping.
 *
 * It dynamically divides available space among an exact integer number of visible
 * columns ($N_{\text{fit}}$), ensuring whole columns fit edge-to-edge without
 * cutting off a half column at the right boundary, and animates width transitions
 * smoothly when shrinking or expanding.
 */
export const useGearTableColumns = (
  pinnedColumnWidth: number,
  options?: GearTableColumnsOptions
): GearTableColumns => {
  const pinnedRightWidth = options?.pinnedRightWidth ?? 0
  const totalColumns =
    options?.totalColumns ??
    (pinnedRightWidth > 0
      ? DEFAULT_TOTAL_MIDDLE_COLUMNS
      : DEFAULT_TOTAL_DATA_COLUMNS)
  const targetColumnWidth =
    options?.targetColumnWidth ??
    (pinnedRightWidth > 0
      ? DEFAULT_TARGET_MIDDLE_COLUMN_WIDTH
      : DEFAULT_TARGET_COLUMN_WIDTH)

  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [scrollState, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false
  })

  useIsomorphicLayoutEffect(() => {
    if (!element) return

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = element
      const maxScrollLeft = scrollWidth - clientWidth
      const canLeft = scrollLeft > 2
      const canRight = maxScrollLeft > 2 && scrollLeft < maxScrollLeft - 2
      setScrollState((prev) => {
        if (
          prev.canScrollLeft === canLeft &&
          prev.canScrollRight === canRight
        ) {
          return prev
        }
        return { canScrollLeft: canLeft, canScrollRight: canRight }
      })
    }

    updateScrollState()
    element.addEventListener('scroll', updateScrollState, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      return () => element.removeEventListener('scroll', updateScrollState)
    }

    // A zero width means the table was never laid out — a `display: none`
    // ancestor, a detached subtree, jsdom — not that it is narrow, so the last
    // known width is kept instead. Without this, collapsing an ancestor would
    // drop a snapped table back to its unpinned layout and it would stay there
    // until something resized it again.
    const measure = (measured: number) => {
      if (measured === 0) return
      setWidth(measured)
      updateScrollState()
    }

    // Measure here rather than leaving it to the observer's first delivery,
    // which lands after the frame has painted — one flash of the wide table on
    // every phone.
    measure(element.clientWidth)

    const observer = new ResizeObserver(() => {
      measure(element.clientWidth)
    })
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [element])

  const availableWidth = width - pinnedColumnWidth - pinnedRightWidth
  const visibleColumnsCount = Math.max(
    1,
    Math.min(totalColumns, Math.floor(availableWidth / targetColumnWidth))
  )
  const isSnapping = width > 0 && visibleColumnsCount < totalColumns

  const columnWidth =
    visibleColumnsCount === 1
      ? Math.max(
          availableWidth,
          Math.min(
            MIN_SNAP_COLUMN_WIDTH,
            availableWidth + SNAP_OVERHANG_ALLOWANCE
          )
        )
      : Math.floor(availableWidth / visibleColumnsCount)

  const scrollByColumn = (direction: 'left' | 'right') => {
    if (!element) return
    const scrollAmount = direction === 'left' ? -columnWidth : columnWidth
    element.scrollBy({ left: scrollAmount, behavior: 'smooth' })
  }

  const pinnedLeftStyle: CSSProperties = {
    minWidth: pinnedColumnWidth,
    ...(isSnapping
      ? { width: pinnedColumnWidth, maxWidth: pinnedColumnWidth }
      : null)
  }

  const pinnedRightStyle: CSSProperties = {
    minWidth: pinnedRightWidth,
    ...(isSnapping
      ? { width: pinnedRightWidth, maxWidth: pinnedRightWidth }
      : null)
  }

  return {
    ref: setElement,
    isSnapping,
    canScrollLeft: isSnapping && scrollState.canScrollLeft,
    canScrollRight: isSnapping && scrollState.canScrollRight,
    scrollByColumn,
    pinnedColumnStyle: pinnedLeftStyle,
    pinnedLeftStyle,
    pinnedRightStyle,
    dataColumnStyle: (minWidth?: number) =>
      isSnapping
        ? {
            width: columnWidth,
            minWidth: columnWidth,
            maxWidth: columnWidth,
            scrollSnapAlign: 'start',
            transition:
              'width 250ms cubic-bezier(0.4, 0, 0.2, 1), min-width 250ms cubic-bezier(0.4, 0, 0.2, 1), max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            ...(visibleColumnsCount === 1 ? { textAlign: 'right' } : null)
          }
        : { minWidth },
    // `scrollPaddingLeft` keeps the snap position clear of the pinned left column,
    // and `scrollPaddingRight` prevents the last column from sliding under the pinned right column.
    scrollerStyle: isSnapping
      ? {
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: pinnedColumnWidth,
          scrollPaddingRight:
            pinnedRightWidth > 0 ? pinnedRightWidth : undefined
        }
      : undefined
  }
}
