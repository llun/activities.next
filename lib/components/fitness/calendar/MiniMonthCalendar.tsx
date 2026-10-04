'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { formatFullDate, formatMonthYear } from '@/lib/fitness/calendar/format'
import { WEEKDAYS, monthGrid } from '@/lib/fitness/calendar/geometry'
import {
  DateKey,
  addDays,
  addMonthsClamped,
  compareDateKeys,
  dateKeyParts,
  toDateKey,
  weekdayMon0
} from '@/lib/fitness/calendar/localDay'
import { MIN_DATE_KEY } from '@/lib/fitness/calendar/ranges'
import { cn } from '@/lib/utils'

export interface VisibleMonth {
  year: number
  /** 1-12. */
  month: number
}

interface MiniMonthCalendarProps {
  /** The month on screen. The parent owns it so a remount keeps it. */
  visible: VisibleMonth
  onVisibleChange: (visible: VisibleMonth) => void
  /** The viewer's local today. Later days are disabled. */
  today: DateKey
  /** The draft's start and end, or `null` while a field is not a real date. */
  from: DateKey | null
  to: DateKey | null
  onSelectDate: (date: DateKey) => void
  /** Sizes every target at 44px regardless of the pointer. */
  touch?: boolean
  className?: string
}

const targetSize = (touch: boolean) =>
  touch ? 'size-11' : 'size-8 pointer-coarse:size-11'

const monthOf = (key: DateKey): VisibleMonth => {
  const { year, month } = dateKeyParts(key)
  return { year, month }
}

/** Where an arrow, Home/End or Page key moves focus from `date`. */
const keyTarget = (key: string, date: DateKey): DateKey | null => {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1)
    case 'ArrowRight':
      return addDays(date, 1)
    case 'ArrowUp':
      return addDays(date, -7)
    case 'ArrowDown':
      return addDays(date, 7)
    case 'Home':
      return addDays(date, -weekdayMon0(date))
    case 'End':
      return addDays(date, 6 - weekdayMon0(date))
    case 'PageUp':
      return addMonthsClamped(date, -1)
    case 'PageDown':
      return addMonthsClamped(date, 1)
    default:
      return null
  }
}

/**
 * The picker's month grid: a month with previous/next arrows, Monday-first
 * weekdays, the draft range washed in orange and its ends filled. Days after
 * today are disabled, and the next arrow is disabled once the next month is
 * entirely in the future.
 *
 * Exactly one day is tabbable (roving focus). Arrow keys move by day and week,
 * Home/End to the week's ends and Page Up/Down by month, so a keyboard user
 * never tabs through thirty buttons.
 */
export function MiniMonthCalendar({
  visible,
  onVisibleChange,
  today,
  from,
  to,
  onSelectDate,
  touch = false,
  className
}: MiniMonthCalendarProps) {
  const grid = useMemo(
    () => monthGrid({ year: visible.year, month: visible.month, today }),
    [visible.year, visible.month, today]
  )
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<DateKey | null>(null)
  const [focusDate, setFocusDate] = useState<DateKey | null>(null)

  const first = grid.days[0].date
  const nextMonthFirst = toDateKey(
    visible.month === 12 ? visible.year + 1 : visible.year,
    visible.month === 12 ? 1 : visible.month + 1,
    1
  )
  const nextDisabled = compareDateKeys(nextMonthFirst, today) > 0
  const previousDisabled = compareDateKeys(first, MIN_DATE_KEY) <= 0

  const isEnabled = (date: DateKey) =>
    compareDateKeys(date, today) <= 0 &&
    compareDateKeys(date, MIN_DATE_KEY) >= 0

  // The one tabbable day: the keyboard's last position, else the range's end,
  // else the first enabled day of the month.
  const inMonth = (date: DateKey | null): date is DateKey =>
    date !== null && date.slice(0, 7) === first.slice(0, 7) && isEnabled(date)
  const tabbable: DateKey | null = inMonth(focusDate)
    ? focusDate
    : inMonth(to)
      ? to
      : inMonth(from)
        ? from
        : (grid.days.find((day) => isEnabled(day.date))?.date ?? null)

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    const button = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${target}"]`
    )
    if (button) {
      pendingFocus.current = null
      button.focus()
    }
  }, [visible.year, visible.month])

  const moveFocus = (target: DateKey) => {
    const clamped =
      compareDateKeys(target, today) > 0
        ? today
        : compareDateKeys(target, MIN_DATE_KEY) < 0
          ? MIN_DATE_KEY
          : target
    setFocusDate(clamped)
    const month = monthOf(clamped)
    if (month.year !== visible.year || month.month !== visible.month) {
      pendingFocus.current = clamped
      onVisibleChange(month)
      return
    }
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${clamped}"]`)
      ?.focus()
  }

  const onDayKeyDown = (event: KeyboardEvent, date: DateKey) => {
    const target = keyTarget(event.key, date)
    if (target === null) return
    event.preventDefault()
    moveFocus(target)
  }

  const step = (delta: -1 | 1) => {
    const target = addMonthsClamped(first, delta)
    onVisibleChange(monthOf(target))
  }

  const arrowClass = cn(
    'text-foreground hover:bg-accent focus-visible:ring-ring inline-flex items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40',
    targetSize(touch)
  )

  const rows: (typeof grid.days)[] = []
  grid.days.forEach((day) => {
    if (!rows[day.row]) rows[day.row] = []
    rows[day.row].push(day)
  })

  return (
    <div
      className={cn('select-none', className)}
      data-testid="mini-month-calendar"
    >
      <div className="mb-1 flex items-center justify-between">
        <p
          className="text-sm font-semibold"
          aria-live="polite"
          data-testid="mini-month-title"
        >
          {formatMonthYear(visible.year, visible.month)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={arrowClass}
            aria-label="Previous month"
            data-focus-key="previous-month"
            disabled={previousDisabled}
            onClick={() => step(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={arrowClass}
            aria-label="Next month"
            data-focus-key="next-month"
            disabled={nextDisabled}
            onClick={() => step(1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={formatMonthYear(visible.year, visible.month)}
        className="w-full"
      >
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday.short}
              role="columnheader"
              aria-label={weekday.long}
              className="text-muted-foreground flex h-8 items-center justify-center text-xs"
            >
              {weekday.short}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="grid grid-cols-7">
            {rowIndex === 0 &&
              Array.from({ length: grid.leading }, (_, index) => (
                <div key={`lead-${index}`} role="gridcell" aria-hidden="true" />
              ))}
            {row.map((day) => {
              const enabled = isEnabled(day.date)
              const isFrom = from !== null && day.date === from
              const isTo = to !== null && day.date === to
              const inverted =
                from !== null && to !== null && compareDateKeys(from, to) > 0
              const washed =
                from !== null &&
                to !== null &&
                !inverted &&
                compareDateKeys(day.date, from) >= 0 &&
                compareDateKeys(day.date, to) <= 0
              const filled = (isFrom || isTo) && !inverted
              const outlined = (isFrom || isTo) && inverted
              const label = [
                formatFullDate(day.date),
                isFrom ? 'start date' : null,
                isTo ? 'end date' : null,
                !enabled ? 'unavailable' : null
              ]
                .filter(Boolean)
                .join(', ')
              return (
                <div
                  key={day.date}
                  role="gridcell"
                  className={cn(
                    'flex items-center justify-center',
                    washed && 'bg-primary/10',
                    washed && isFrom && 'rounded-l-full',
                    washed && isTo && 'rounded-r-full',
                    washed && day.col === 0 && 'rounded-l-md',
                    washed && day.col === 6 && 'rounded-r-md'
                  )}
                >
                  <button
                    type="button"
                    data-date={day.date}
                    data-focus-key={`day-${day.date}`}
                    aria-label={label}
                    aria-pressed={filled || outlined}
                    aria-current={day.isToday ? 'date' : undefined}
                    disabled={!enabled}
                    tabIndex={day.date === tabbable ? 0 : -1}
                    onClick={() => {
                      setFocusDate(day.date)
                      onSelectDate(day.date)
                    }}
                    onKeyDown={(event) => onDayKeyDown(event, day.date)}
                    className={cn(
                      'focus-visible:ring-ring inline-flex items-center justify-center rounded-full text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                      targetSize(touch),
                      !enabled && 'text-muted-foreground/50 cursor-default',
                      enabled && !filled && !washed && 'hover:bg-accent',
                      washed && !filled && 'text-primary-text',
                      filled && 'bg-primary text-primary-foreground',
                      outlined && 'ring-primary text-foreground ring-2',
                      day.isToday &&
                        !filled &&
                        'underline decoration-2 underline-offset-4'
                    )}
                  >
                    {day.day}
                  </button>
                </div>
              )
            })}
            {rowIndex === rows.length - 1 &&
              Array.from({ length: grid.trailing }, (_, index) => (
                <div
                  key={`trail-${index}`}
                  role="gridcell"
                  aria-hidden="true"
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
