'use client'

import {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo
} from 'react'

import { formatMonthShort, formatRange } from '@/lib/fitness/calendar/format'
import {
  ANNUAL_CELL_GAP,
  ANNUAL_CELL_MAX,
  ANNUAL_CELL_MIN,
  ANNUAL_LABEL_WIDTH,
  AnnualYearGrid,
  CalendarDayRange,
  annualCellSize,
  annualYearGrids
} from '@/lib/fitness/calendar/geometry'
import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'
import {
  DateKey,
  compareDateKeys,
  dateKeyParts,
  toDateKey
} from '@/lib/fitness/calendar/localDay'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

import { AnnualYearRow } from './AnnualYearRow'
import { Box, CalendarTooltip, useCalendarTooltip } from './CalendarTooltip'
import styles from './calendar.module.css'
import { dateOfElement, describeDay, indexDays } from './calendarShared'
import { useElementWidth } from './useElementWidth'
import { useRovingDateFocus } from './useRovingDateFocus'

/** Room kept to the right of the last column so its selection ring is not clipped. */
const OUTLINE_ROOM = 3

export interface AnnualCalendarHandle {
  /** Moves keyboard focus to a day's cell, scrolling it into view. */
  focusDate: (date: DateKey) => void
}

export interface AnnualCalendarProps {
  /** The applied range: days outside it are slashed and cannot be selected. */
  range: CalendarDayRange
  /** The viewer's today, as a date key in the viewer's zone. */
  today: DateKey
  /** Days with activity; a day with no entry is a rest day. */
  days: readonly FitnessCalendarDay[]
  metric: HeatMetric
  /** The pinned day, or `null`. */
  selectedDate: DateKey | null
  /** Keep the layout, dim to 0.6 and show the skeleton sweep. */
  loading?: boolean
  /** Rendered beside the last year's caption (the legend). */
  legend?: ReactNode
  onSelectDate: (date: DateKey) => void
  /** A month label was activated: open that month. */
  onOpenMonth: (year: number, month: number) => void
  ref?: Ref<AnnualCalendarHandle>
  className?: string
}

const captionFor = (
  grid: AnnualYearGrid,
  range: CalendarDayRange,
  today: DateKey
): string => {
  // The year-to-date grid ends at today: say "through", not a range.
  if (grid.lastDate === today && compareDateKeys(range.to, today) >= 0) {
    const { day, month } = dateKeyParts(today)
    return `Activity through ${day} ${formatMonthShort(month)}`
  }
  const yearStart = toDateKey(grid.year, 1, 1)
  const from =
    compareDateKeys(range.from, yearStart) > 0 ? range.from : yearStart
  const to =
    compareDateKeys(range.to, grid.lastDate) < 0 ? range.to : grid.lastDate
  return formatRange(from, to)
}

/**
 * The annual heatmap: one labelled row per calendar year the range touches,
 * oldest first, each a grid of week columns of perfect squares.
 *
 * Cell size is measured from the container (a ResizeObserver, not the window)
 * through the shared `annualCellSize` helper: `clamp(12, (w - 28 - N*3) / N,
 * 18)` for the year with the most columns, so every row's squares are the same
 * size. Below 12px the cells stay 12px and each row scrolls inside itself; the
 * page never overflows. Before a width is known (server render, hydration) the
 * same formula runs in CSS container units, so nothing jumps.
 *
 * The component takes data and callbacks only: it neither fetches nor owns the
 * selection. One tab stop covers every cell (arrows, Home, End, PageUp and
 * PageDown move; Enter or a click selects; Escape bubbles to the parent, which
 * can restore focus through the `focusDate` handle).
 */
export const AnnualCalendar = ({
  range,
  today,
  days,
  metric,
  selectedDate,
  loading = false,
  legend,
  onSelectDate,
  onOpenMonth,
  ref,
  className
}: AnnualCalendarProps) => {
  const [rootRef, width] = useElementWidth<HTMLDivElement>()
  const helpId = useId()
  const dayIndex = useMemo(() => indexDays(days), [days])

  const { from, to } = range
  const grids = useMemo(
    () => annualYearGrids({ range: { from, to }, today }),
    [from, to, today]
  )

  const focusableDates = useMemo(
    () =>
      grids.flatMap((grid) =>
        grid.cells
          .filter((cell) => cell.state !== 'out')
          .map((cell) => cell.date)
      ),
    [grids]
  )

  const roving = useRovingDateFocus({
    dates: focusableDates,
    layout: 'annual',
    preferred: selectedDate ?? today
  })
  const tooltip = useCalendarTooltip({ suppressedDate: selectedDate })

  const { focusDate } = roving
  useImperativeHandle(
    ref,
    () => ({ focusDate: (date: DateKey) => focusDate(date, { smooth: true }) }),
    [focusDate]
  )

  const maxWeeks = grids.reduce((max, grid) => Math.max(max, grid.weeks), 0)
  const cellSize =
    width === null
      ? // Container units: the same clamp the helper evaluates.
        `clamp(${ANNUAL_CELL_MIN}px, calc((100cqw - ${ANNUAL_LABEL_WIDTH + OUTLINE_ROOM}px - ${maxWeeks * ANNUAL_CELL_GAP}px) / ${maxWeeks}), ${ANNUAL_CELL_MAX}px)`
      : `${annualCellSize(width - OUTLINE_ROOM, maxWeeks)}px`

  const { onKeyDown: rovingKeyDown, onFocus: rovingFocus } =
    roving.containerProps
  const {
    onKeyDown: tooltipKeyDown,
    onFocus: tooltipFocus,
    ...tooltipHandlers
  } = tooltip.containerProps

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      tooltipKeyDown(event)
      rovingKeyDown(event)
    },
    [tooltipKeyDown, rovingKeyDown]
  )

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      rovingFocus(event)
      tooltipFocus(event)
    },
    [rovingFocus, tooltipFocus]
  )

  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const hit = dateOfElement(event.target as Element, event.currentTarget)
      if (!hit || hit.element.dataset.state !== 'active') return
      tooltip.hide()
      onSelectDate(hit.date)
    },
    [onSelectDate, tooltip]
  )

  const getAvoidBoxes = useCallback((): Box[] => {
    const root = roving.containerProps.ref.current
    if (!root) return []
    return Array.from(
      root.querySelectorAll<HTMLElement>('[data-avoid-tooltip]')
    ).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      }
    })
  }, [roving.containerProps.ref])

  const tooltipTarget = tooltip.target
  const tooltipContent = useMemo(() => {
    if (!tooltipTarget) return null
    const { title, detail } = describeDay(
      tooltipTarget.date,
      'active',
      dayIndex.get(tooltipTarget.date),
      loading
    )
    return { title, detail }
  }, [tooltipTarget, dayIndex, loading])

  if (grids.length === 0) return null

  return (
    <div
      ref={rootRef}
      data-slot="annual-calendar"
      className={cn('fitness-heat @container w-full', className)}
      style={{ '--cell': cellSize } as CSSProperties}
    >
      <p id={helpId} className="sr-only">
        Use the arrow keys to move between days, Home and End for the first and
        last day of the year, and Enter to select a day.
      </p>
      {/* Narrow containers only (the phone designs, M01): the grid scrolls
          inside itself there and the 12px cells are too small to be the way in,
          so say how to scroll and that a month label opens that month. Wide
          containers fit the whole year and need neither. */}
      <p
        data-slot="annual-hint"
        className="text-muted-foreground mt-2 mb-1 flex flex-wrap justify-between gap-x-4 text-xs @min-[600px]:hidden"
      >
        <span>Tap a month label to open it</span>
        <span>Scroll for earlier months</span>
      </p>
      {/* Rows sit 4px apart: each already carries 27px above its month labels
          (their hit band), which is what separates one year from the next and
          the first year from the metric control above. */}
      <div
        ref={roving.containerProps.ref}
        data-loading={loading || undefined}
        aria-busy={loading || undefined}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onClick={handleClick}
        {...tooltipHandlers}
        className={cn(styles.dim, 'flex flex-col gap-1')}
      >
        {grids.map((grid, index) => (
          <AnnualYearRow
            key={grid.year}
            grid={grid}
            caption={captionFor(grid, range, today)}
            dayIndex={dayIndex}
            metric={metric}
            selectedDate={selectedDate}
            tabStopDate={roving.tabStopDate}
            loading={loading}
            layoutKey={cellSize}
            trailing={index === grids.length - 1 ? legend : undefined}
            helpId={helpId}
            onOpenMonth={onOpenMonth}
            onScroll={tooltip.onScroll}
          />
        ))}
      </div>
      <CalendarTooltip
        target={tooltipTarget}
        content={tooltipContent}
        getAvoidBoxes={getAvoidBoxes}
      />
    </div>
  )
}
