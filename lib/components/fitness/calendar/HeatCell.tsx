'use client'

import { memo } from 'react'

import { HeatLevel } from '@/lib/fitness/calendar/heatLevels'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import { cn } from '@/lib/utils'

import styles from './calendar.module.css'
import { CellKind } from './calendarShared'

export interface HeatCellProps {
  date: DateKey
  /** `annual`: a bare square. `month`: a numbered square. */
  variant: 'annual' | 'month'
  kind: CellKind
  level: HeatLevel
  /** Day of the month; drawn in a month cell. */
  numeral?: number
  isToday: boolean
  selected: boolean
  /** The calendar's one tab stop. */
  tabStop: boolean
  loading: boolean
  /** The accessible name: the full date and every value. */
  label: string
  /** One-based grid column and row, so a day sits where its weekday is. */
  column: number
  row: number
}

/**
 * One day of the calendar.
 *
 * - `active` is a button: it selects the day (the parent reads `data-date`; the
 *   calendar delegates one click handler, so the cell holds no callbacks and
 *   memoises on plain values). `aria-pressed` marks the selected day and
 *   `aria-current="date"` marks today.
 * - `upcoming` and `out` are disabled buttons, so they cannot take focus or
 *   selection and still announce what they are.
 *
 * Nothing relies on colour alone: today is a dot (annual) or an underline
 * (month), selection is an outline, focus is corner brackets, an out-of-range
 * day is slashed and an upcoming day is outlined, not filled.
 */
export const HeatCell = memo(function HeatCell({
  date,
  variant,
  kind,
  level,
  numeral,
  isToday,
  selected,
  tabStop,
  loading,
  label,
  column,
  row
}: HeatCellProps) {
  const interactive = kind === 'active'
  return (
    <button
      type="button"
      data-date={date}
      data-state={kind}
      data-level={interactive ? level : undefined}
      data-loading={loading || undefined}
      aria-label={label}
      aria-pressed={interactive ? selected : undefined}
      aria-current={isToday ? 'date' : undefined}
      disabled={!interactive}
      tabIndex={interactive && tabStop ? 0 : -1}
      className={cn(
        styles.cell,
        variant === 'annual' ? styles.annual : styles.month
      )}
      style={{ gridColumn: column, gridRow: row }}
    >
      {variant === 'month' && (
        <span className={isToday ? styles.todayNumeral : undefined}>
          {numeral}
        </span>
      )}
      {variant === 'annual' && isToday && (
        <span aria-hidden="true" className={styles.todayDot} />
      )}
    </button>
  )
})
