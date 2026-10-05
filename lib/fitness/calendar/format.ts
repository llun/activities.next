/**
 * Text for the fitness overview calendar, in the British English style of the
 * designs ("24 September 2026", "1,024h").
 *
 * The repo's other fitness formatters do not fit: `formatFitnessDuration`
 * renders `h:mm:ss`, `formatFitnessDistance` has no thousands separator and a
 * different decimal rule, and the gear and dashboard helpers are US-style or
 * private to a page. The calendar needs one consistent set, so it lives here.
 *
 * A date key is a calendar day with no time zone, so it is formatted from its
 * own year, month and day through name tables; no `Date`, no `Intl` date
 * formatting and nothing that reads the process zone. Only `formatLocalTime`
 * takes a zone, and takes it explicitly.
 */
import { DateKey, dateKeyParts, weekdayMon0 } from './localDay'

const NBSP = ' '
const EN_DASH = '–'

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

const MONTHS_SHORT = MONTHS_LONG.map((name) => name.slice(0, 3))

const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
] as const

const WEEKDAYS_SHORT = WEEKDAYS_LONG.map((name) => name.slice(0, 3))

const integerFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 0
})

/** A whole number with thousands separators: "1,024". */
export const formatInteger = (value: number): string =>
  integerFormatter.format(value)

const oneDecimalFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

/** "September 2026". */
export const formatMonthYear = (year: number, month1: number): string =>
  `${MONTHS_LONG[month1 - 1]} ${year}`

/** "Sep": the label above a month column in the annual grid. */
export const formatMonthShort = (month1: number): string =>
  MONTHS_SHORT[month1 - 1]

/** "Thursday, 24 September 2026". */
export const formatFullDate = (key: DateKey): string => {
  const { year, month, day } = dateKeyParts(key)
  return `${WEEKDAYS_LONG[weekdayMon0(key)]}, ${day} ${MONTHS_LONG[month - 1]} ${year}`
}

/** "Thu 24 Sep": a row in the month list, where the year is the heading's. */
export const formatWeekdayDayMonth = (key: DateKey): string => {
  const { month, day } = dateKeyParts(key)
  return `${WEEKDAYS_SHORT[weekdayMon0(key)]} ${day} ${MONTHS_SHORT[month - 1]}`
}

const dayMonth = (key: DateKey) => {
  const { month, day } = dateKeyParts(key)
  return `${day} ${MONTHS_SHORT[month - 1]}`
}

/**
 * An inclusive range of days: "1 Jan – 4 Oct 2026". The year is given once when
 * both ends share it and on both ends when they do not
 * ("5 Oct 2025 – 4 Oct 2026"); a single day is "4 Oct 2026". Within one month
 * the month is given once too: "1 – 4 Oct 2026", not "1 Oct – 4 Oct 2026".
 */
export const formatRange = (from: DateKey, to: DateKey): string => {
  const fromParts = dateKeyParts(from)
  const toParts = dateKeyParts(to)
  const fromYear = fromParts.year
  const toYear = toParts.year
  if (from === to) return `${dayMonth(to)} ${toYear}`
  if (fromYear === toYear && fromParts.month === toParts.month) {
    return `${fromParts.day} ${EN_DASH} ${dayMonth(to)} ${toYear}`
  }
  if (fromYear === toYear) {
    return `${dayMonth(from)} ${EN_DASH} ${dayMonth(to)} ${toYear}`
  }
  return `${dayMonth(from)} ${fromYear} ${EN_DASH} ${dayMonth(to)} ${toYear}`
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0)

/**
 * Distance in metres as kilometres: one decimal ("42.6 km"), or a whole number
 * with thousands separators from 100 km ("1,024 km").
 */
export const formatDistance = (meters: number): string => {
  const km = Math.max(0, finite(meters)) / 1000
  const oneDecimal = Math.round(km * 10) / 10
  // Judge on the rounded value so 99.96 km reads "100 km", not "100.0 km".
  if (oneDecimal >= 100) return `${integerFormatter.format(km)}${NBSP}km`
  return `${oneDecimalFormatter.format(oneDecimal)}${NBSP}km`
}

/**
 * Duration in seconds, rounded to the nearest minute: "42m", "1h 14m", "2h",
 * "1,024h 5m". The spaces are non-breaking.
 */
export const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.round(Math.max(0, finite(seconds)) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  const hourText = `${integerFormatter.format(hours)}h`
  return minutes === 0 ? hourText : `${hourText}${NBSP}${minutes}m`
}

/** Elevation gain in metres, whole numbers with separators: "24,680 m". */
export const formatElevation = (meters: number): string =>
  `${integerFormatter.format(Math.max(0, finite(meters)))}${NBSP}m`

/** "1 activity", "2 activities", "0 activities". */
export const formatActivityCount = (count: number): string =>
  `${integerFormatter.format(count)} ${count === 1 ? 'activity' : 'activities'}`

const timeFormatters = new Map<string, Intl.DateTimeFormat>()
const MAX_CACHED_TIME_ZONES = 64

/**
 * The wall-clock time of an instant in an explicit IANA zone, 24-hour:
 * "07:05". The zone is the viewer's, never the process's. Throws a
 * `RangeError` for an unknown zone.
 */
export const formatLocalTime = (ms: number, timeZone: string): string => {
  let formatter = timeFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    if (timeFormatters.size >= MAX_CACHED_TIME_ZONES) timeFormatters.clear()
    timeFormatters.set(timeZone, formatter)
  }
  return formatter.format(new Date(ms))
}
