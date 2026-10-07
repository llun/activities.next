'use client'

import {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'

import { formatMonthYear } from '@/lib/fitness/calendar/format'
import {
  CalendarDayRange,
  MONTH_CELL_GAP,
  MONTH_CELL_MAX,
  MONTH_COLUMNS,
  monthCellSize,
  monthGrid
} from '@/lib/fitness/calendar/geometry'
import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'
import { DateKey, compareDateKeys } from '@/lib/fitness/calendar/localDay'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

import { Box, CalendarTooltip, useCalendarTooltip } from './CalendarTooltip'
import { HeatCell } from './HeatCell'
import styles from './calendar.module.css'
import {
  CALENDAR_MOTION,
  CellKind,
  DayIndex,
  dateOfElement,
  describeDay,
  indexDays,
  levelOfDay
} from './calendarShared'
import { useElementWidth } from './useElementWidth'
import { useRovingDateFocus } from './useRovingDateFocus'

export interface MonthCalendarHandle {
  /** Moves keyboard focus to a day's cell. */
  focusDate: (date: DateKey) => void
}

export interface MonthCalendarProps {
  year: number
  /** 1-12. */
  month: number
  /** The viewer's today. Days after it are upcoming: outlined and disabled. */
  today: DateKey
  /** The applied range, when it can cut the month: days outside it are slashed. */
  range?: CalendarDayRange
  days: readonly FitnessCalendarDay[]
  metric: HeatMetric
  selectedDate: DateKey | null
  /** Keep the layout, dim to 0.6 and show the skeleton sweep. */
  loading?: boolean
  /**
   * Crossfade (75ms out, 75ms in, opacity only) when `year` or `month` change.
   * The new month appears after the fade-out; pass `false` to swap at once.
   */
  crossfade?: boolean
  onSelectDate: (date: DateKey) => void
  /** Rendered after the grid (a caption and legend). */
  children?: ReactNode
  ref?: Ref<MonthCalendarHandle>
  className?: string
}

const WEEKDAY_HEADERS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun'
] as const

/**
 * One month as seven columns of numbered squares, left-aligned.
 *
 * The cell is `min(92, (w - 24) / 7)` (4px gaps), measured from the container
 * through the shared `monthCellSize` helper, so it is the same square on a
 * 908px desktop column and a 358px phone. Day numbers and corner radius scale
 * with it (13-18px type, 6-12px radius). Below 44px (a container under 332px)
 * the cells are too small to tap with confidence: render `MonthDayList` as the
 * accessible alternative (`monthNeedsListAlternative`).
 *
 * Days after today are outlined and disabled; Heat 4 numerals use the black
 * text token so they stay at least 4.5:1.
 *
 * Takes data and callbacks only. One tab stop, arrow keys move by day (Left,
 * Right) and week (Up, Down), Home and End go to the start and end of the week,
 * PageUp and PageDown clamp to the month. Enter or a click selects; Escape
 * bubbles to the parent, which restores focus through the `focusDate` handle.
 */
export const MonthCalendar = ({
  year,
  month,
  today,
  range,
  days,
  metric,
  selectedDate,
  loading = false,
  crossfade = true,
  onSelectDate,
  children,
  ref,
  className
}: MonthCalendarProps) => {
  const [rootRef, width] = useElementWidth<HTMLDivElement>()
  const helpId = useId()
  const liveIndex = useMemo(() => indexDays(days), [days])

  // Crossfade: when the month changes, fade the old grid out, then swap and
  // fade in. While it fades out it keeps drawing the month it had (and that
  // month's data), so the old cells do not flash into the new month's colours.
  const [shown, setShown] = useState({ year, month })
  const changing = shown.year !== year || shown.month !== month
  const fadingOut = crossfade && changing
  const frozenIndex = useRef<DayIndex>(liveIndex)
  if (!fadingOut) frozenIndex.current = liveIndex

  useEffect(() => {
    if (!changing) return
    if (!crossfade) {
      setShown({ year, month })
      return
    }
    const timer = setTimeout(
      () => setShown({ year, month }),
      CALENDAR_MOTION.crossfadeHalfMs
    )
    return () => clearTimeout(timer)
  }, [changing, crossfade, year, month])

  const view = fadingOut ? shown : { year, month }
  const dayIndex = fadingOut ? frozenIndex.current : liveIndex

  const grid = useMemo(
    () => monthGrid({ year: view.year, month: view.month, today }),
    [view.year, view.month, today]
  )

  const rangeFrom = range?.from
  const rangeTo = range?.to
  const described = useMemo(
    () =>
      grid.days.map((day) => {
        const kind: CellKind =
          day.state === 'upcoming'
            ? 'upcoming'
            : (rangeFrom && compareDateKeys(day.date, rangeFrom) < 0) ||
                (rangeTo && compareDateKeys(day.date, rangeTo) > 0)
              ? 'out'
              : 'active'
        const entry = kind === 'active' ? dayIndex.get(day.date) : undefined
        return {
          day,
          kind,
          entry,
          label: describeDay(day.date, kind, entry, loading).label
        }
      }),
    [grid, dayIndex, rangeFrom, rangeTo, loading]
  )

  const focusableDates = useMemo(
    () =>
      described
        .filter((item) => item.kind === 'active')
        .map((item) => item.day.date),
    [described]
  )

  const roving = useRovingDateFocus({
    dates: focusableDates,
    layout: 'month',
    preferred: selectedDate ?? today
  })
  const tooltip = useCalendarTooltip({ suppressedDate: selectedDate })

  const { focusDate } = roving
  useImperativeHandle(
    ref,
    () => ({ focusDate: (date: DateKey) => focusDate(date) }),
    [focusDate]
  )

  const cellSize =
    width === null
      ? `min(${MONTH_CELL_MAX}px, calc((100cqw - ${(MONTH_COLUMNS - 1) * MONTH_CELL_GAP}px) / ${MONTH_COLUMNS}))`
      : `${monthCellSize(width)}px`

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

  return (
    <div
      ref={rootRef}
      data-slot="month-calendar"
      className={cn('fitness-heat @container w-full', className)}
      style={{ '--cell': cellSize } as CSSProperties}
    >
      <p id={helpId} className="sr-only">
        Use the arrow keys to move between days, Home and End for the start and
        end of the week, and Enter to select a day.
      </p>
      <div data-fading={fadingOut || undefined} className={styles.fade}>
        <div
          data-loading={loading || undefined}
          aria-busy={loading || undefined}
          className={styles.dim}
        >
          <div
            ref={roving.containerProps.ref}
            role="group"
            aria-label={formatMonthYear(view.year, view.month)}
            aria-describedby={helpId}
            data-year={view.year}
            data-month={view.month}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onClick={handleClick}
            {...tooltipHandlers}
            className="grid w-max"
            style={{
              gridTemplateColumns: `repeat(${MONTH_COLUMNS}, var(--cell))`,
              gap: MONTH_CELL_GAP
            }}
          >
            {WEEKDAY_HEADERS.map((name, index) => (
              <div
                key={name}
                aria-hidden="true"
                data-avoid-tooltip=""
                className="text-muted-foreground pb-0.5 text-center text-xs"
                style={{ gridRow: 1, gridColumn: index + 1 }}
              >
                {name}
              </div>
            ))}
            {described.map(({ day, kind, entry, label }) => (
              <HeatCell
                key={day.date}
                date={day.date}
                variant="month"
                kind={kind}
                level={levelOfDay(metric, entry)}
                numeral={day.day}
                isToday={day.isToday}
                selected={day.date === selectedDate}
                tabStop={day.date === roving.tabStopDate}
                loading={loading}
                label={label}
                column={day.col + 1}
                row={day.row + 2}
              />
            ))}
          </div>
        </div>
      </div>
      <CalendarTooltip
        target={tooltipTarget}
        content={tooltipContent}
        getAvoidBoxes={getAvoidBoxes}
      />
      {children}
    </div>
  )
}
