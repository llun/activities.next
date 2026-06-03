'use client'

import { FC, useMemo } from 'react'

import { FitnessCalendarDay } from '@/lib/client'

export type CalendarMetric = 'count' | 'distance' | 'duration'

interface Props {
  days: FitnessCalendarDay[]
  metric: CalendarMetric
  periodType: 'all_time' | 'yearly' | 'monthly'
  periodKey: string
  startDate?: number
  endDate?: number
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

const MS_DAY = 24 * 60 * 60 * 1000
// Width of a single week column: a 12px (h-3/w-3) cell plus the 2px (gap-0.5)
// gutter. The label rows are positioned against this stride so they stay
// aligned with the grid columns.
const CELL = 14
// Spans longer than ~14 months switch from dense month labels to a year row
// (with a lighter month row beneath it) so a multi-year range stays legible.
const YEAR_LABEL_SPAN_DAYS = 430

const getMetricValue = (day: FitnessCalendarDay, metric: CalendarMetric) => {
  switch (metric) {
    case 'count':
      return day.count
    case 'distance':
      return day.totalDistanceMeters
    case 'duration':
      return day.totalDurationSeconds
  }
}

const getColorClass = (value: number, max: number): string => {
  if (value === 0 || max === 0) return 'bg-muted'
  const ratio = value / max
  if (ratio < 0.25) return 'bg-green-200 dark:bg-green-900'
  if (ratio < 0.5) return 'bg-green-400 dark:bg-green-700'
  if (ratio < 0.75) return 'bg-green-500 dark:bg-green-500'
  return 'bg-green-700 dark:bg-green-400'
}

const formatTooltipValue = (
  day: FitnessCalendarDay,
  metric: CalendarMetric
): string => {
  const date = day.date
  switch (metric) {
    case 'count':
      return `${date}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}`
    case 'distance': {
      const km = (day.totalDistanceMeters / 1000).toFixed(1)
      return `${date}: ${km} km`
    }
    case 'duration': {
      const hours = Math.floor(day.totalDurationSeconds / 3600)
      const minutes = Math.floor((day.totalDurationSeconds % 3600) / 60)
      return hours > 0
        ? `${date}: ${hours}h ${minutes}m`
        : `${date}: ${minutes}m`
    }
  }
}

// A label pinned to the start of the period it names. `weekIndex` is the grid
// column where the period begins, so the label can be positioned by stride.
interface PeriodLabel {
  label: string
  weekIndex: number
}

interface CalendarGrid {
  weeks: Array<Array<{ date: string; day: FitnessCalendarDay | null } | null>>
  monthLabels: PeriodLabel[]
  yearLabels: PeriodLabel[]
}

const formatDate = (date: Date): string => {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Register at most one label per grid column. When the range starts mid-period
// and the next period also begins inside that first partial week, both would
// claim the same `weekIndex` and `StickyLabelRow` would render a zero-width
// segment, overlapping the two labels at the left edge. Keep the first (the
// period the column starts in).
const pushLabel = (
  labels: PeriodLabel[],
  label: string,
  weekIndex: number
): void => {
  if (labels.length > 0 && labels[labels.length - 1].weekIndex === weekIndex) {
    return
  }
  labels.push({ label, weekIndex })
}

const buildGrid = (
  startDate: Date,
  endDate: Date,
  dayMap: Map<string, FitnessCalendarDay>
): CalendarGrid => {
  const weeks: CalendarGrid['weeks'] = []
  const monthLabels: PeriodLabel[] = []
  const yearLabels: PeriodLabel[] = []

  const current = new Date(startDate)
  const dayOfWeek = current.getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  current.setUTCDate(current.getUTCDate() + mondayOffset)

  let lastMonth = -1
  let lastYear = -1

  while (current <= endDate || weeks.length === 0) {
    const week: CalendarGrid['weeks'][0] = []

    for (let d = 0; d < 7; d++) {
      const dateStr = formatDate(current)
      const inRange = current >= startDate && current <= endDate

      if (inRange) {
        week.push({
          date: dateStr,
          day: dayMap.get(dateStr) ?? null
        })

        const month = current.getUTCMonth()
        const year = current.getUTCFullYear()
        if (year !== lastYear) {
          lastYear = year
          pushLabel(yearLabels, String(year), weeks.length)
        }
        if (month !== lastMonth) {
          lastMonth = month
          pushLabel(monthLabels, MONTH_NAMES[month], weeks.length)
        }
      } else {
        week.push(null)
      }

      current.setUTCDate(current.getUTCDate() + 1)
    }

    weeks.push(week)
  }

  return { weeks, monthLabels, yearLabels }
}

const getDateRange = (
  periodType: string,
  periodKey: string
): { start: Date; end: Date } => {
  if (periodType === 'yearly') {
    const year = parseInt(periodKey, 10)
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year, 11, 31))
    }
  }

  if (periodType === 'monthly') {
    const [yearStr, monthStr] = periodKey.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1
    return {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 0))
    }
  }

  const now = new Date()
  const start = new Date(
    Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())
  )
  return { start, end: now }
}

// A horizontal row of labels that "stick" to the left edge of the scroll
// viewport: each label is pinned inside a segment spanning its own period, so it
// stays visible until the next period scrolls in and pushes it out (the same
// behaviour as a GitHub contribution graph). The label carries an opaque
// `bg-card` so it cleanly occludes the next label as that one scrolls under it.
const StickyLabelRow: FC<{
  items: PeriodLabel[]
  totalWeeks: number
  height: number
  className: string
}> = ({ items, totalWeeks, height, className }) => {
  if (items.length === 0) {
    return <div style={{ height, width: totalWeeks * CELL }} />
  }

  const lead = items[0].weekIndex
  return (
    <div className="flex" style={{ height, width: totalWeeks * CELL }}>
      {lead > 0 && <div className="shrink-0" style={{ width: lead * CELL }} />}
      {items.map((item, index) => {
        const next = items[index + 1]
        const segmentWeeks =
          (next ? next.weekIndex : totalWeeks) - item.weekIndex
        return (
          <div
            key={index}
            className="shrink-0"
            style={{ width: segmentWeeks * CELL }}
          >
            <span
              className={`sticky left-0 inline-block whitespace-nowrap bg-card pr-1.5 ${className}`}
            >
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const FitnessCalendarHeatmap: FC<Props> = ({
  days,
  metric,
  periodType,
  periodKey,
  startDate,
  endDate
}) => {
  const dayMap = useMemo(() => {
    const map = new Map<string, FitnessCalendarDay>()
    for (const day of days) {
      map.set(day.date, day)
    }
    return map
  }, [days])

  const maxValue = useMemo(() => {
    let max = 0
    for (const day of days) {
      const val = getMetricValue(day, metric)
      if (val > max) max = val
    }
    return max
  }, [days, metric])

  const { start, end } = useMemo(() => {
    if (startDate !== undefined && endDate !== undefined) {
      return { start: new Date(startDate), end: new Date(endDate) }
    }

    return getDateRange(periodType, periodKey)
  }, [periodType, periodKey, startDate, endDate])

  const grid = useMemo(
    () => buildGrid(start, end, dayMap),
    [start, end, dayMap]
  )

  if (days.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity data for this period
      </p>
    )
  }

  const totalWeeks = grid.weeks.length
  const gridWidth = totalWeeks * CELL
  const spanDays = (end.getTime() - start.getTime()) / MS_DAY
  const useYearLabels = spanDays > YEAR_LABEL_SPAN_DAYS
  // Year mode stacks a 16px year row over a 14px month row (plus the 2px gap),
  // so the day-label column needs a matching 32px spacer to stay aligned.
  const headerHeight = useYearLabels ? 32 : 16

  return (
    <div className="flex gap-0.5">
      {/* Fixed left column — day labels stay out of the horizontal scroll area,
          so the scrollbar spans only the grid (never runs under the labels). */}
      <div className="flex shrink-0 flex-col gap-1">
        <div style={{ height: headerHeight }} />
        <div className="flex w-7 flex-col gap-0.5">
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="flex h-3 items-center text-[10px] leading-none text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable grid with sticky period labels. min-w-0 lets this flex
          child shrink below its content so it scrolls instead of overflowing
          the card on narrow screens. */}
      <div className="min-w-0 overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          {useYearLabels ? (
            <div className="flex flex-col gap-0.5" style={{ width: gridWidth }}>
              <StickyLabelRow
                items={grid.yearLabels}
                totalWeeks={totalWeeks}
                height={16}
                className="text-[10px] font-semibold text-foreground"
              />
              <StickyLabelRow
                items={grid.monthLabels}
                totalWeeks={totalWeeks}
                height={14}
                className="text-[9px] leading-none text-muted-foreground"
              />
            </div>
          ) : (
            <StickyLabelRow
              items={grid.monthLabels}
              totalWeeks={totalWeeks}
              height={16}
              className="text-[10px] text-muted-foreground"
            />
          )}

          {/* Week columns */}
          <div className="flex gap-0.5">
            {grid.weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-0.5">
                {week.map((cell, di) => {
                  if (!cell) {
                    return <div key={di} className="h-3 w-3" />
                  }

                  const value = cell.day ? getMetricValue(cell.day, metric) : 0
                  const colorClass = getColorClass(value, maxValue)
                  const tooltip = cell.day
                    ? formatTooltipValue(cell.day, metric)
                    : `${cell.date}: No activity`

                  return (
                    <div
                      key={di}
                      className={`h-3 w-3 rounded-sm ${colorClass}`}
                      title={tooltip}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
