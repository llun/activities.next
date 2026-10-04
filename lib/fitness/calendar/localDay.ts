/**
 * Calendar-day math for the fitness overview.
 *
 * A calendar day is a **date key** (`YYYY-MM-DD`, free of any time zone). A
 * time zone matters in exactly one place: turning a date key into the instant
 * window `[startOfLocalDay(k), startOfLocalDay(k + 1))`, or an instant back
 * into the key of the local day it falls on. Every function that needs a zone
 * takes the IANA name explicitly and reads it through `Intl` only; none of
 * them touches the process zone, so a result is the same whatever `TZ` the
 * server or test runner uses.
 *
 * The module is dependency-free (no React, no Node APIs, no project imports)
 * so the database layer, the routes and the browser can all import it.
 *
 * Arithmetic on date keys is plain UTC calendar arithmetic and is therefore
 * immune to daylight saving: `addDays('2026-03-28', 1)` is `2026-03-29` in
 * every zone, even though that local day is only 23 hours long in Amsterdam.
 */

export type DateKey = string & { readonly __brand: 'DateKey' }

const MS_PER_SECOND = 1000
const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND
const MS_PER_DAY = 24 * MS_PER_HOUR

// The earliest and latest years a date key can hold. Four digits keep key
// strings sortable with plain string comparison.
const MIN_YEAR = 1
const MAX_YEAR = 9999

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const WALL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

// No zone has ever been more than about 16 hours from UTC, so a window of 30
// hours either side of a date's UTC midnight always brackets the instant that
// local date begins.
const SEARCH_RADIUS_MS = 30 * MS_PER_HOUR

// How far either side of a wall-clock time `instantAtLocalWallTime` samples
// the zone's offset to find the offsets that could apply to it.
const OFFSET_SAMPLE_RADIUS_MS = 40 * MS_PER_HOUR

const pad = (value: number, length: number) =>
  String(value).padStart(length, '0')

/** UTC epoch milliseconds of a calendar date and time, valid for any year. */
const utcMs = (
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) => {
  // `Date.UTC` maps years 0-99 onto 1900-1999, so set the year explicitly.
  const date = new Date(0)
  date.setUTCFullYear(year, month1 - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  return date.getTime()
}

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

export const daysInMonth = (year: number, month1: number): number => {
  if (!Number.isInteger(year) || !Number.isInteger(month1)) {
    throw new RangeError(`Invalid year or month: ${year}, ${month1}`)
  }
  if (month1 < 1 || month1 > 12) {
    throw new RangeError(`Month out of range: ${month1}`)
  }
  if (month1 === 2) return isLeapYear(year) ? 29 : 28
  return month1 === 4 || month1 === 6 || month1 === 9 || month1 === 11 ? 30 : 31
}

const isRealDate = (year: number, month1: number, day: number) =>
  Number.isInteger(year) &&
  Number.isInteger(month1) &&
  Number.isInteger(day) &&
  year >= MIN_YEAR &&
  year <= MAX_YEAR &&
  month1 >= 1 &&
  month1 <= 12 &&
  day >= 1 &&
  day <= daysInMonth(year, month1)

/** Builds a date key. Throws a `RangeError` for a date that does not exist. */
export const toDateKey = (year: number, month1: number, day: number) => {
  if (!isRealDate(year, month1, day)) {
    throw new RangeError(`Invalid calendar date: ${year}-${month1}-${day}`)
  }
  return `${pad(year, 4)}-${pad(month1, 2)}-${pad(day, 2)}` as DateKey
}

/**
 * Validates a `YYYY-MM-DD` string and returns it as a date key, or `null` when
 * it is malformed or not a real calendar date (`2026-02-30`, `2100-02-29`).
 */
export const parseDateKey = (value: string): DateKey | null => {
  if (typeof value !== 'string') return null
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return isRealDate(year, month, day) ? (value as DateKey) : null
}

export const dateKeyParts = (key: DateKey) => ({
  year: Number(key.slice(0, 4)),
  month: Number(key.slice(5, 7)),
  day: Number(key.slice(8, 10))
})

const dateKeyUtcMs = (key: DateKey) => {
  const { year, month, day } = dateKeyParts(key)
  return utcMs(year, month, day)
}

const dateKeyFromUtcMs = (ms: number) => {
  const date = new Date(ms)
  return toDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  )
}

/** Moves a date key by whole calendar days. Throws outside years 1-9999. */
export const addDays = (key: DateKey, days: number): DateKey => {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError(`Day count must be an integer: ${days}`)
  }
  return dateKeyFromUtcMs(dateKeyUtcMs(key) + days * MS_PER_DAY)
}

/**
 * Moves a date key by whole calendar months, clamping the day to the length of
 * the target month: `2024-02-29` minus 12 months is `2023-02-28`.
 */
export const addMonthsClamped = (key: DateKey, months: number): DateKey => {
  if (!Number.isSafeInteger(months)) {
    throw new RangeError(`Month count must be an integer: ${months}`)
  }
  const { year, month, day } = dateKeyParts(key)
  const monthIndex = year * 12 + (month - 1) + months
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = monthIndex - targetYear * 12 + 1
  if (targetYear < MIN_YEAR || targetYear > MAX_YEAR) {
    throw new RangeError(`Date out of range: ${targetYear}`)
  }
  return toDateKey(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth))
  )
}

export const compareDateKeys = (a: DateKey, b: DateKey): -1 | 0 | 1 =>
  a < b ? -1 : a > b ? 1 : 0

/**
 * Number of calendar days from `from` to `to`, both included. Zero when `to` is
 * the day before `from`, and negative when it is earlier still.
 */
export const inclusiveDayCount = (from: DateKey, to: DateKey): number =>
  Math.round((dateKeyUtcMs(to) - dateKeyUtcMs(from)) / MS_PER_DAY) + 1

/** Day of the week with Monday as 0 and Sunday as 6. */
export const weekdayMon0 = (key: DateKey): number =>
  (new Date(dateKeyUtcMs(key)).getUTCDay() + 6) % 7

const MAX_CACHED_ZONES = 64
const formatterCache = new Map<string, Intl.DateTimeFormat>()

const getFormatter = (timeZone: string) => {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  // Zone names come from requests, so keep the cache from growing without
  // bound when every casing variant of a name is a distinct key.
  if (formatterCache.size >= MAX_CACHED_ZONES) formatterCache.clear()
  formatterCache.set(timeZone, formatter)
  return formatter
}

const localParts = (ms: number, timeZone: string) => {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Instant must be a finite number: ${ms}`)
  }
  const values = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of getFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type in values) {
      values[part.type as keyof typeof values] = Number(part.value)
    }
  }
  return values
}

/** The zone's offset from UTC, in milliseconds, at an instant. */
const offsetAtMs = (ms: number, timeZone: string) => {
  const { year, month, day, hour, minute, second } = localParts(ms, timeZone)
  const wall = utcMs(year, month, day, hour % 24, minute, second)
  return wall - Math.floor(ms / MS_PER_SECOND) * MS_PER_SECOND
}

/** True when `Intl` knows the zone name. Offset forms such as `+05:30` pass. */
export const isValidTimeZone = (timeZone: string): boolean => {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Named IANA zones only, the form the fitness routes accept and the browser
 * sends. `Intl` also accepts offset forms such as `+05:30`, but those carry no
 * daylight-saving rules, so a calendar built on one would put activities on
 * the wrong day for half the year. The leading letter rules them out;
 * `Etc/GMT+12` still passes because the sign sits after the area.
 */
export const NAMED_TIME_ZONE_PATTERN =
  /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

/** True for a named IANA zone (see `NAMED_TIME_ZONE_PATTERN`) that `Intl` knows. */
export const isNamedTimeZone = (timeZone: string): boolean =>
  typeof timeZone === 'string' &&
  NAMED_TIME_ZONE_PATTERN.test(timeZone) &&
  isValidTimeZone(timeZone)

/** The canonical spelling of a zone (`Asia/Calcutta`, `europe/amsterdam`). */
export const canonicalTimeZone = (timeZone: string): string => {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new RangeError(`Invalid time zone: ${JSON.stringify(timeZone)}`)
  }
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions()
    .timeZone
}

/** The date key of the local day an instant falls on in the zone. */
export const localDateKeyAt = (ms: number, timeZone: string): DateKey => {
  const { year, month, day } = localParts(ms, timeZone)
  return toDateKey(year, month, day)
}

/**
 * The first instant of a local day: the earliest instant whose local date is
 * `key` or later.
 *
 * That definition is what keeps the windows `[start(D), start(D + 1))` a
 * partition of the timeline in every zone:
 * - a day that opens at 01:00 because midnight was skipped
 *   (`America/Santiago` 2026-09-06, `America/Havana` 2026-03-08) starts at
 *   01:00;
 * - a day that never happened (`Pacific/Apia` 2011-12-30, when Samoa crossed
 *   the date line) starts at the same instant as the next day, so its window
 *   is empty;
 * - a day with a repeated hour (fall back) is 25 hours long.
 *
 * Throws a `RangeError` when the zone is not valid.
 */
export const startOfLocalDay = (key: DateKey, timeZone: string): number => {
  const wall = dateKeyUtcMs(key)

  // Fast path: the offset in force at the day's UTC midnight is usually the
  // one in force at its local midnight. When a transition lies in between,
  // applying the offset a second time finds it.
  let guess = wall - offsetAtMs(wall, timeZone)
  guess = wall - offsetAtMs(guess, timeZone)
  if (
    localDateKeyAt(guess, timeZone) === key &&
    localDateKeyAt(guess - 1, timeZone) < key
  ) {
    return guess
  }

  // Slow path, taken only around gaps and overlaps: binary search for the
  // earliest second whose local date has reached the key.
  let low = wall - SEARCH_RADIUS_MS
  let high = wall + SEARCH_RADIUS_MS
  while (high - low > MS_PER_SECOND) {
    const middle =
      low + Math.floor((high - low) / (2 * MS_PER_SECOND)) * MS_PER_SECOND
    if (localDateKeyAt(middle, timeZone) >= key) high = middle
    else low = middle
  }
  return high
}

/**
 * The instant window covering the local days `from` to `toInclusive`:
 * `startMs` is the start of `from`, `endMs` is **exclusive** and is the start
 * of the day after `toInclusive`.
 */
export const localDayWindow = (
  from: DateKey,
  toInclusive: DateKey,
  timeZone: string
): { startMs: number; endMs: number } => {
  if (compareDateKeys(from, toInclusive) > 0) {
    throw new RangeError(
      `Range ends before it starts: ${from} to ${toInclusive}`
    )
  }
  return {
    startMs: startOfLocalDay(from, timeZone),
    endMs: startOfLocalDay(addDays(toInclusive, 1), timeZone)
  }
}

/**
 * The instant at which a zone's clock reads `HH:MM` on a local day, for tests
 * and seed scripts. In an overlap (a repeated hour) it is the earlier of the
 * two instants. Throws a `RangeError` for a wall time the zone skipped, so a
 * fixture cannot silently land an hour away from where it says.
 */
export const instantAtLocalWallTime = (
  key: DateKey,
  time: string,
  timeZone: string
): number => {
  const match = WALL_TIME_PATTERN.exec(time)
  if (!match) throw new RangeError(`Wall time must be HH:MM: ${time}`)
  const { year, month, day } = dateKeyParts(key)
  const wall = utcMs(year, month, day, Number(match[1]), Number(match[2]))

  // The offsets that can apply are the ones in force before and after any
  // transition near the wall time. Keep each candidate instant whose local
  // clock really does read the wall time.
  const offsets = new Set(
    [-OFFSET_SAMPLE_RADIUS_MS, 0, OFFSET_SAMPLE_RADIUS_MS].map((delta) =>
      offsetAtMs(wall + delta, timeZone)
    )
  )
  const instants = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => offsetAtMs(instant, timeZone) === wall - instant)
  if (instants.length === 0) {
    throw new RangeError(`${key} ${time} does not exist in ${timeZone}`)
  }
  return Math.min(...instants)
}

/**
 * Groups rows into local-day buckets in one pass. `rowsAsc` must be sorted
 * ascending by `getMs`; days without rows produce no bucket.
 *
 * Each bucket's day `D` is verified against `startOfLocalDay`, the same
 * function that builds the query window, so a row lands in `D` exactly when
 * `startOfLocalDay(D) <= ms < startOfLocalDay(D + 1)`. A calendar built from
 * these buckets therefore agrees with the day-detail and summary reads.
 *
 * Throws a `RangeError` for a non-finite instant or rows out of order, rather
 * than filing a row under the wrong day.
 */
export const bucketByLocalDay = <R>(
  rowsAsc: readonly R[],
  timeZone: string,
  getMs: (row: R) => number
): Array<{ date: DateKey; rows: R[] }> => {
  const buckets: Array<{ date: DateKey; rows: R[] }> = []
  let current: { date: DateKey; rows: R[] } | null = null
  let endMs = Number.NEGATIVE_INFINITY
  let previousMs = Number.NEGATIVE_INFINITY

  for (const row of rowsAsc) {
    const ms = getMs(row)
    if (!Number.isFinite(ms)) {
      throw new RangeError(`Row instant must be a finite number: ${ms}`)
    }
    if (ms < previousMs) {
      throw new RangeError('Rows must be sorted ascending by instant')
    }
    previousMs = ms

    if (current === null || ms >= endMs) {
      let date = localDateKeyAt(ms, timeZone)
      // The local date of an instant always lies inside its own window; these
      // loops only guard that invariant against an unusual zone history.
      let startMs = startOfLocalDay(date, timeZone)
      while (ms < startMs) {
        date = addDays(date, -1)
        startMs = startOfLocalDay(date, timeZone)
      }
      let nextStartMs = startOfLocalDay(addDays(date, 1), timeZone)
      while (ms >= nextStartMs) {
        date = addDays(date, 1)
        nextStartMs = startOfLocalDay(addDays(date, 1), timeZone)
      }
      endMs = nextStartMs
      current = { date, rows: [] }
      buckets.push(current)
    }
    current.rows.push(row)
  }
  return buckets
}
