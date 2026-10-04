'use client'

import {
  CSSProperties,
  ReactNode,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  formatMonthShort,
  formatMonthYear
} from '@/lib/fitness/calendar/format'
import {
  ANNUAL_CELL_GAP,
  ANNUAL_LABEL_WIDTH,
  AnnualYearGrid,
  WEEKDAYS
} from '@/lib/fitness/calendar/geometry'
import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import { cn } from '@/lib/utils'

import { HeatCell } from './HeatCell'
import styles from './calendar.module.css'
import { CellKind, DayIndex, describeDay, levelOfDay } from './calendarShared'
import {
  ANNUAL_SNAP_PADDING,
  EDGE_FADE_WIDTH,
  EdgeFades,
  edgeFades,
  sameEdgeFades
} from './edgeFades'

/** Height of the month-label row, and of the year label above the weekdays. */
const LABEL_ROW_HEIGHT = 14

export interface AnnualYearRowProps {
  grid: AnnualYearGrid
  /** What the row covers, after the year: "Activity through 4 Oct". */
  caption: string
  dayIndex: DayIndex
  metric: HeatMetric
  selectedDate: DateKey | null
  /** The calendar's one tab stop (may be in another row). */
  tabStopDate: DateKey | null
  loading: boolean
  /** Changes whenever the cell size does, so the scroll affordances re-measure. */
  layoutKey: string
  /** Shown to the right of the caption (the legend, on the last row). */
  trailing?: ReactNode
  /** Id of the keyboard help text the group is described by. */
  helpId: string
  onOpenMonth: (year: number, month: number) => void
  onScroll?: () => void
}

/**
 * One calendar year of the annual heatmap: a sticky year and weekday column
 * beside a grid of week columns that scrolls inside itself when the cells
 * would otherwise be smaller than 12px.
 *
 * The labels are a flex row beside the grid, not part of it, because
 * `position: sticky` does not work on a grid item. Padding slots (the empty
 * positions before 1 January and after the last day) are never rendered: each
 * day is placed on its own column and row, so the gaps are simply absent.
 *
 * Scrolling: snap to month-start columns (`x proximity`, with scroll padding
 * for the sticky labels plus the fade, so a snapped month is fully opaque),
 * `overscroll-behavior-x: contain`, a 16px fade only on a side with hidden
 * content, and an instant jump to the end (today) when it first appears.
 */
export const AnnualYearRow = memo(function AnnualYearRow({
  grid,
  caption,
  dayIndex,
  metric,
  selectedDate,
  tabStopDate,
  loading,
  layoutKey,
  trailing,
  helpId,
  onOpenMonth,
  onScroll
}: AnnualYearRowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const interacted = useRef(false)
  const frame = useRef(0)
  const [fades, setFades] = useState<EdgeFades>({ start: false, end: false })

  const syncFades = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const next = edgeFades({
      scrollLeft: element.scrollLeft,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    })
    setFades((previous) => (sameEdgeFades(previous, next) ? previous : next))
  }, [])

  // A new row (another range) starts at the end again.
  useLayoutEffect(() => {
    interacted.current = false
  }, [grid.year, grid.weeks])

  // Start at the end so today is visible, instantly (assigning `scrollLeft`
  // never animates), until the person scrolls; keep it there while the cell
  // size settles after the first measurement or a resize.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    if (!interacted.current) element.scrollLeft = element.scrollWidth
    syncFades()
  }, [layoutKey, grid.weeks, syncFades])

  const handleScroll = useCallback(() => {
    onScroll?.()
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      syncFades()
    })
  }, [onScroll, syncFades])

  const markInteracted = useCallback(() => {
    interacted.current = true
  }, [])

  // Descriptions depend on the data and the grid, not on the metric or the
  // selection, so a metric switch or a pinned day re-renders cells without
  // rebuilding 366 sentences.
  const described = useMemo(
    () =>
      grid.cells.map((cell) => {
        const kind: CellKind = cell.state === 'out' ? 'out' : 'active'
        const day = kind === 'active' ? dayIndex.get(cell.date) : undefined
        return {
          cell,
          kind,
          day,
          label: describeDay(cell.date, kind, day).label
        }
      }),
    [grid, dayIndex]
  )

  const scrollerStyle = {
    '--label-w': `${ANNUAL_LABEL_WIDTH}px`,
    '--fade-w': `${EDGE_FADE_WIDTH}px`,
    scrollPaddingInlineStart: `${ANNUAL_SNAP_PADDING}px`
  } as CSSProperties

  return (
    <div
      role="group"
      aria-label={`Training calendar, ${grid.year}`}
      aria-describedby={helpId}
      data-year={grid.year}
    >
      <div
        ref={scroller}
        data-slot="annual-scroller"
        data-tooltip-boundary=""
        data-tooltip-inset-start={ANNUAL_LABEL_WIDTH}
        data-fade-start={fades.start}
        data-fade-end={fades.end}
        onScroll={handleScroll}
        onPointerDown={markInteracted}
        onWheel={markInteracted}
        onTouchStart={markInteracted}
        onKeyDown={markInteracted}
        style={scrollerStyle}
        // The top padding holds the month labels' 44px hit band, so it is
        // inside the scroller (clipped at its edges) and never reaches the
        // metric control above.
        className={cn(
          styles.scroller,
          'snap-x snap-proximity overflow-x-auto overflow-y-hidden overscroll-x-contain pt-[27px] pb-2'
        )}
      >
        <div className="flex w-max pr-[3px]" style={{ gap: ANNUAL_CELL_GAP }}>
          <div
            aria-hidden="true"
            data-slot="annual-labels"
            className={cn(
              styles.labels,
              'sticky left-0 z-10 flex flex-none flex-col text-[10px]'
            )}
            style={{ width: ANNUAL_LABEL_WIDTH, gap: ANNUAL_CELL_GAP }}
          >
            <span
              data-slot="annual-year-label"
              className="text-foreground font-semibold"
              style={{
                height: LABEL_ROW_HEIGHT,
                lineHeight: `${LABEL_ROW_HEIGHT}px`
              }}
            >
              {grid.year}
            </span>
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday.short}
                className="text-muted-foreground whitespace-nowrap"
                style={{ height: 'var(--cell)', lineHeight: 'var(--cell)' }}
              >
                {weekday.short}
              </span>
            ))}
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${grid.weeks}, var(--cell))`,
              gridTemplateRows: `${LABEL_ROW_HEIGHT}px repeat(7, var(--cell))`,
              gap: ANNUAL_CELL_GAP
            }}
          >
            {grid.monthLabels.map((label) => (
              <MonthStart
                key={label.month}
                year={grid.year}
                label={label}
                onOpenMonth={onOpenMonth}
              />
            ))}
            {described.map(({ cell, kind, day, label }) => (
              <HeatCell
                key={cell.date}
                date={cell.date}
                variant="annual"
                kind={kind}
                level={levelOfDay(metric, day)}
                isToday={cell.isToday}
                selected={cell.date === selectedDate}
                tabStop={cell.date === tabStopDate}
                loading={loading}
                label={label}
                column={cell.col + 1}
                row={cell.row + 2}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 text-[13px]">
        <p className="m-0">
          <span className="text-foreground font-semibold">{grid.year}</span>
          {' · '}
          {caption}
        </p>
        {trailing}
      </div>
    </div>
  )
})

const MonthStart = ({
  year,
  label,
  onOpenMonth
}: {
  year: number
  label: AnnualYearGrid['monthLabels'][number]
  onOpenMonth: (year: number, month: number) => void
}) => {
  const placement: CSSProperties = {
    gridRow: 1,
    gridColumn: `${label.col + 1} / span ${label.span}`,
    justifySelf: label.alignEnd ? 'end' : undefined
  }
  return (
    <>
      {/* The snap anchor: the whole month-start column, so a snapped month is
          aligned by its first week. It takes no pointer and no space. */}
      <i
        aria-hidden="true"
        data-snap-anchor=""
        data-month={label.month}
        data-column={label.col}
        className="pointer-events-none snap-start"
        style={{ gridRow: '1 / -1', gridColumn: label.col + 1 }}
      />
      {label.inRange ? (
        <button
          type="button"
          data-slot="month-label"
          data-month={label.month}
          data-avoid-tooltip=""
          aria-label={`Show ${formatMonthYear(year, label.month)}`}
          onClick={() => onOpenMonth(year, label.month)}
          className={cn(
            styles.monthLabel,
            'text-muted-foreground hover:bg-muted hover:text-foreground h-[14px] cursor-pointer rounded-[3px] border-0 bg-transparent p-0 text-left text-[10px] leading-[14px] whitespace-nowrap outline-none'
          )}
          style={placement}
        >
          {formatMonthShort(label.month)}
        </button>
      ) : (
        <span
          aria-hidden="true"
          data-slot="month-label"
          data-month={label.month}
          data-avoid-tooltip=""
          className="text-muted-foreground h-[14px] text-[10px] leading-[14px] whitespace-nowrap"
          style={placement}
        >
          {formatMonthShort(label.month)}
        </span>
      )}
    </>
  )
}
