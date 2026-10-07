'use client'

import { ChevronRight } from 'lucide-react'
import { MouseEvent, useCallback, useMemo } from 'react'

import {
  formatMonthYear,
  formatWeekdayDayMonth
} from '@/lib/fitness/calendar/format'
import { CalendarDayRange, monthGrid } from '@/lib/fitness/calendar/geometry'
import { HeatMetric } from '@/lib/fitness/calendar/heatLevels'
import { DateKey, compareDateKeys } from '@/lib/fitness/calendar/localDay'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

import styles from './calendar.module.css'
import {
  dateOfElement,
  indexDays,
  levelOfDay,
  summarizeDay
} from './calendarShared'

export interface MonthDayListProps {
  year: number
  /** 1-12. */
  month: number
  today: DateKey
  /** The applied range: days outside it are left out of the list. */
  range?: CalendarDayRange
  days: readonly FitnessCalendarDay[]
  metric: HeatMetric
  selectedDate: DateKey | null
  /** Keep the layout, dim to 0.6 and show static swatches. */
  loading?: boolean
  onSelectDate: (date: DateKey) => void
  className?: string
}

/**
 * The accessible alternative to the month grid where its cells would be under
 * 44px (a 320px phone): one row per day, each at least 44px (56 in the design)
 * with the date, a heat swatch and the count, distance and duration spelled out.
 *
 * Rows are buttons, `aria-pressed` for the selected day and `aria-current` for
 * today (also said in words). Days that have not happened yet are not rows:
 * they collapse into one non-interactive "Upcoming" line at the end.
 */
export const MonthDayList = ({
  year,
  month,
  today,
  range,
  days,
  metric,
  selectedDate,
  loading = false,
  onSelectDate,
  className
}: MonthDayListProps) => {
  const dayIndex = useMemo(() => indexDays(days), [days])
  const grid = useMemo(
    () => monthGrid({ year, month, today }),
    [year, month, today]
  )

  const { rows, upcoming } = useMemo(() => {
    const listed = grid.days.filter((day) => {
      if (day.state === 'upcoming') return false
      if (range && compareDateKeys(day.date, range.from) < 0) return false
      if (range && compareDateKeys(day.date, range.to) > 0) return false
      return true
    })
    const later = grid.days.filter((day) => day.state === 'upcoming')
    return { rows: listed, upcoming: later }
  }, [grid, range])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const hit = dateOfElement(event.target as Element, event.currentTarget)
      if (hit) onSelectDate(hit.date)
    },
    [onSelectDate]
  )

  const upcomingText =
    upcoming.length === 0
      ? null
      : upcoming.length === 1
        ? `Upcoming: ${formatWeekdayDayMonth(upcoming[0].date)}`
        : `Upcoming: ${formatWeekdayDayMonth(upcoming[0].date)} – ${formatWeekdayDayMonth(upcoming[upcoming.length - 1].date)}`

  return (
    <ul
      aria-label={`${formatMonthYear(year, month)}, day by day`}
      aria-busy={loading || undefined}
      data-slot="month-day-list"
      onClick={handleClick}
      className={cn(
        'fitness-heat divide-border m-0 flex list-none flex-col divide-y p-0',
        styles.dim,
        className
      )}
      data-loading={loading || undefined}
    >
      {rows.map((day) => {
        const entry = dayIndex.get(day.date)
        const selected = day.date === selectedDate
        return (
          <li key={day.date}>
            <button
              type="button"
              data-date={day.date}
              aria-pressed={selected}
              aria-current={day.isToday ? 'date' : undefined}
              className={cn(
                'focus-visible:ring-ring/50 flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left outline-none focus-visible:ring-[3px]',
                'hover:bg-accent',
                selected && 'bg-accent ring-primary ring-2 ring-inset'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(styles.swatch, loading && 'skeleton')}
                data-level={loading ? undefined : levelOfDay(metric, entry)}
                style={
                  loading ? { backgroundColor: 'var(--skeleton)' } : undefined
                }
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground text-sm font-semibold">
                  {formatWeekdayDayMonth(day.date)}
                  {day.isToday && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      Today
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  {summarizeDay(entry, loading)}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground size-4 flex-none"
              />
            </button>
          </li>
        )
      })}
      {upcomingText && (
        <li
          data-slot="upcoming-summary"
          className="text-muted-foreground flex min-h-11 items-center gap-3 px-2 text-[13px]"
        >
          <span
            aria-hidden="true"
            data-upcoming="true"
            className={styles.swatch}
          />
          {upcomingText}
        </li>
      )}
    </ul>
  )
}
