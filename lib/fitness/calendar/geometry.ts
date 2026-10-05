/**
 * Pure layout math for the fitness overview calendar: which cell sits in which
 * column and row, and how big a cell is for the width it has.
 *
 * No React, no DOM, no clock and no time zone: every function takes the
 * viewer's `today` as a date key (derived once, in the viewer's zone, by the
 * caller) and works on calendar dates only, so the result is the same on the
 * server, in the browser and under any `TZ`.
 *
 * Padding slots (the empty positions before 1 January and after the last day
 * in the first and last week column) are *marked* here but have no cell: the UI
 * renders no element at all for them.
 */
import {
  DateKey,
  addDays,
  compareDateKeys,
  daysInMonth,
  inclusiveDayCount,
  toDateKey,
  weekdayMon0
} from './localDay'

/** An inclusive range of calendar days. */
export interface CalendarDayRange {
  from: DateKey
  to: DateKey
}

/** Monday-first weekday labels, in grid row order. */
export const WEEKDAYS = [
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
  { short: 'Sun', long: 'Sunday' }
] as const

const DAYS_PER_WEEK = 7

// A month label (and its 44px tap target) spans four week columns. Consecutive
// month starts are at least four columns apart (the shortest month is 28 days),
// so labels laid out at their own column never overlap. Four columns is 57px at
// the smallest cell, so the target is wider than 44px everywhere but the last
// label, which is clamped by the grid's end.
const MONTH_LABEL_SPAN = 4

/* -------------------------------------------------------------------------- */
/* Annual grid                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * - `in`: inside the applied range, a real day with data.
 * - `today`: the same as `in`, and it is today.
 * - `out`: a real day of the year that the applied range does not cover.
 *   Subdued and not interactive; distinct from a rest day, which is an `in`
 *   cell with no activity.
 */
export type AnnualCellState = 'in' | 'out' | 'today'

export interface AnnualCell {
  date: DateKey
  /** Zero-based week column, counted from the grid's first Monday. */
  col: number
  /** Weekday row, Monday = 0. */
  row: number
  state: AnnualCellState
  /** True for today whether or not the range covers it. */
  isToday: boolean
}

/** A grid slot that holds no day. The UI renders nothing for it. */
export interface AnnualPaddingSlot {
  col: number
  row: number
  position: 'leading' | 'trailing'
}

export interface AnnualMonthLabel {
  /** 1-12. */
  month: number
  /** The week column that contains the 1st of the month. */
  col: number
  /** Columns the label may occupy, 1-4: fewer only at the end of the grid. */
  span: number
  /** The label would overrun the grid, so it is right-aligned inside its span. */
  alignEnd: boolean
  /** At least one day of the month (up to the grid's end) is in the range. */
  inRange: boolean
}

export interface AnnualYearGrid {
  year: number
  /** First and last day shown: 1 Jan to 31 Dec, or to today for this year. */
  firstDate: DateKey
  lastDate: DateKey
  /** Week columns; `0` when the whole year is still in the future. */
  weeks: number
  /** Real days only, in date order. */
  cells: AnnualCell[]
  padding: AnnualPaddingSlot[]
  leadingPadding: number
  trailingPadding: number
  monthLabels: AnnualMonthLabel[]
  /**
   * The column of each month's 1st, in month order: the scroll-snap anchors.
   * Months that start after the last day shown have no entry.
   */
  monthStartColumns: number[]
}

const emptyAnnualGrid = (year: number): AnnualYearGrid => ({
  year,
  firstDate: toDateKey(year, 1, 1),
  lastDate: toDateKey(year, 12, 31),
  weeks: 0,
  cells: [],
  padding: [],
  leadingPadding: 0,
  trailingPadding: 0,
  monthLabels: [],
  monthStartColumns: []
})

const dayOffset = (from: DateKey, to: DateKey) =>
  inclusiveDayCount(from, to) - 1

/**
 * The grid of one calendar year.
 *
 * Weeks are Monday-first and the grid begins on the Monday on or before 1
 * January. It ends on 31 December, or on `today` when `today` falls inside the
 * year (a year-to-date grid never shows upcoming days). A year that has not
 * started yet has no weeks.
 *
 * `range` decides which days are `in`: every other real day in the grid is
 * `out`. This is what makes a multi-year range one full row per year with the
 * parts outside the range subdued.
 */
export const annualYearGrid = ({
  year,
  range,
  today
}: {
  year: number
  range: CalendarDayRange
  today: DateKey
}): AnnualYearGrid => {
  const yearStart = toDateKey(year, 1, 1)
  const yearEnd = toDateKey(year, 12, 31)
  const lastDate = compareDateKeys(today, yearEnd) < 0 ? today : yearEnd
  if (compareDateKeys(lastDate, yearStart) < 0) return emptyAnnualGrid(year)

  const leadingPadding = weekdayMon0(yearStart)
  const gridStart = addDays(yearStart, -leadingPadding)
  const weeks = Math.floor(dayOffset(gridStart, lastDate) / DAYS_PER_WEEK) + 1
  const trailingPadding = DAYS_PER_WEEK - 1 - weekdayMon0(lastDate)

  const padding: AnnualPaddingSlot[] = []
  for (let row = 0; row < leadingPadding; row += 1) {
    padding.push({ col: 0, row, position: 'leading' })
  }
  for (
    let row = DAYS_PER_WEEK - trailingPadding;
    row < DAYS_PER_WEEK;
    row += 1
  ) {
    padding.push({ col: weeks - 1, row, position: 'trailing' })
  }

  const cells: AnnualCell[] = []
  let date = yearStart
  for (;;) {
    const offset = dayOffset(gridStart, date)
    const isToday = date === today
    const inRange =
      compareDateKeys(date, range.from) >= 0 &&
      compareDateKeys(date, range.to) <= 0
    cells.push({
      date,
      col: Math.floor(offset / DAYS_PER_WEEK),
      row: offset % DAYS_PER_WEEK,
      state: !inRange ? 'out' : isToday ? 'today' : 'in',
      isToday
    })
    if (date === lastDate) break
    date = addDays(date, 1)
  }

  const monthLabels: AnnualMonthLabel[] = []
  for (let month = 1; month <= 12; month += 1) {
    const first = toDateKey(year, month, 1)
    if (compareDateKeys(first, lastDate) > 0) break
    const col = Math.floor(dayOffset(gridStart, first) / DAYS_PER_WEEK)
    const span = Math.min(MONTH_LABEL_SPAN, weeks - col)
    const last = toDateKey(year, month, daysInMonth(year, month))
    const shownLast = compareDateKeys(last, lastDate) < 0 ? last : lastDate
    monthLabels.push({
      month,
      col,
      span,
      alignEnd: span < MONTH_LABEL_SPAN,
      inRange:
        compareDateKeys(first, range.to) <= 0 &&
        compareDateKeys(shownLast, range.from) >= 0
    })
  }

  return {
    year,
    firstDate: yearStart,
    lastDate,
    weeks,
    cells,
    padding,
    leadingPadding,
    trailingPadding,
    monthLabels,
    monthStartColumns: monthLabels.map((label) => label.col)
  }
}

/**
 * One grid per calendar year the range touches, oldest first. Years that have
 * not started yet (a range that runs past `today`) are left out.
 */
export const annualYearGrids = ({
  range,
  today
}: {
  range: CalendarDayRange
  today: DateKey
}): AnnualYearGrid[] => {
  const firstYear = Number(range.from.slice(0, 4))
  const lastYear = Math.min(
    Number(range.to.slice(0, 4)),
    Number(today.slice(0, 4))
  )
  const grids: AnnualYearGrid[] = []
  for (let year = firstYear; year <= lastYear; year += 1) {
    grids.push(annualYearGrid({ year, range, today }))
  }
  return grids
}

/* -------------------------------------------------------------------------- */
/* Month grid                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * - `past`: on or before today (in a month that has already ended, every day).
 * - `today`: today.
 * - `upcoming`: after today. Outlined and not interactive.
 */
export type MonthDayState = 'past' | 'today' | 'upcoming'

export interface MonthDay {
  date: DateKey
  /** Day of the month, 1-31. */
  day: number
  /** Weekday column, Monday = 0. */
  col: number
  /** Week row, counted from the first (possibly partial) week. */
  row: number
  state: MonthDayState
  isToday: boolean
}

export interface MonthGrid {
  year: number
  /** 1-12. */
  month: number
  /** Empty columns before the 1st (Monday = 0, so Tuesday = 1). */
  leading: number
  /** Empty columns after the last day in its week. */
  trailing: number
  /** Week rows, partial first and last weeks included. */
  weeks: number
  weekdays: typeof WEEKDAYS
  days: MonthDay[]
  /** Today falls inside this month. */
  isCurrentMonth: boolean
}

export const monthGrid = ({
  year,
  month,
  today
}: {
  year: number
  month: number
  today: DateKey
}): MonthGrid => {
  const dayCount = daysInMonth(year, month)
  const first = toDateKey(year, month, 1)
  const leading = weekdayMon0(first)
  const days: MonthDay[] = []
  for (let day = 1; day <= dayCount; day += 1) {
    const date = toDateKey(year, month, day)
    const order = compareDateKeys(date, today)
    const position = leading + day - 1
    days.push({
      date,
      day,
      col: position % DAYS_PER_WEEK,
      row: Math.floor(position / DAYS_PER_WEEK),
      state: order < 0 ? 'past' : order === 0 ? 'today' : 'upcoming',
      isToday: order === 0
    })
  }
  const weeks = Math.ceil((leading + dayCount) / DAYS_PER_WEEK)
  return {
    year,
    month,
    leading,
    trailing: weeks * DAYS_PER_WEEK - leading - dayCount,
    weeks,
    weekdays: WEEKDAYS,
    days,
    isCurrentMonth: days.some((day) => day.isToday)
  }
}

/* -------------------------------------------------------------------------- */
/* Cell sizes                                                                  */
/* -------------------------------------------------------------------------- */

export const ANNUAL_CELL_MIN = 12
export const ANNUAL_CELL_MAX = 18
export const ANNUAL_CELL_GAP = 3
/** Width of the sticky weekday label column. */
export const ANNUAL_LABEL_WIDTH = 28

export const MONTH_CELL_MAX = 92
export const MONTH_CELL_GAP = 4
export const MONTH_COLUMNS = 7
/** The smallest touch target the calendar commits to. */
export const MIN_TOUCH_TARGET = 44

const clamp = (min: number, value: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** The cell size before it is clamped; negative when `avail` is very small. */
const annualRawCellSize = (avail: number, weeks: number) =>
  (avail - ANNUAL_LABEL_WIDTH - weeks * ANNUAL_CELL_GAP) / weeks

/**
 * Side of an annual cell: `clamp(12, (avail - 28 - N*3) / N, 18)` for `weeks`
 * columns in `avail` pixels. Cells stay square.
 */
export const annualCellSize = (avail: number, weeks: number): number => {
  if (!(weeks > 0) || !Number.isFinite(avail)) return ANNUAL_CELL_MIN
  return clamp(
    ANNUAL_CELL_MIN,
    annualRawCellSize(avail, weeks),
    ANNUAL_CELL_MAX
  )
}

/** Side of a month cell: `min(92, (avail - 24) / 7)`, never below 0. */
export const monthCellSize = (avail: number): number => {
  if (!Number.isFinite(avail)) return 0
  const gaps = (MONTH_COLUMNS - 1) * MONTH_CELL_GAP
  return Math.max(0, Math.min(MONTH_CELL_MAX, (avail - gaps) / MONTH_COLUMNS))
}

/**
 * True when 7 month cells of 44px with their gaps do not fit in `avail`, so
 * the cells would fall below the touch-target size and the list alternative
 * should be offered (container narrower than 332px).
 */
export const monthNeedsListAlternative = (avail: number): boolean =>
  MONTH_COLUMNS * MIN_TOUCH_TARGET + (MONTH_COLUMNS - 1) * MONTH_CELL_GAP >
  avail
