// The event line of an announcement, as drawn in the design system:
// "Sat Jun 13, 09:00 – 10:00 UTC" — 24 h, weekday and date once, the end bound
// reduced to its time when it falls on the same day, and the time zone named.
//
// The format is fixed (en-US shape) rather than the reader's locale, because
// its parts are composed by hand; only the time zone follows the reader.

const LOCALE = 'en-US'
const SEPARATOR = ' – '

interface FormatEventTimeParams {
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  // Overrides the reader's time zone. Only tests need it; the banner leaves it
  // out so timed events render in the reader's own zone.
  timeZone?: string
}

const parse = (iso: string | null): Date | null => {
  if (!iso) return null
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : new Date(time)
}

const formatToParts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, options).formatToParts(date)

// "Sat Jun 13" — no comma after the weekday, unlike the en-US default.
const formatDay = (date: Date, timeZone?: string): string => {
  const parts = formatToParts(date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone
  })
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('weekday')} ${part('month')} ${part('day')}`
}

// "09:00" — 24-hour clock, always two digits (hourCycle h23 so midnight is
// "00:00", never "24:00").
const formatClock = (date: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone
  }).format(date)

// "UTC", "PDT", "GMT+7": the short name of the zone in effect at that instant.
const formatZone = (date: Date, timeZone?: string): string =>
  formatToParts(date, { timeZoneName: 'short', timeZone }).find(
    (part) => part.type === 'timeZoneName'
  )?.value ?? ''

// Calendar-day identity in the rendering zone, for the same-day collapse.
const dayKey = (date: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).format(date)

export const formatEventTime = ({
  startsAt,
  endsAt,
  allDay,
  timeZone
}: FormatEventTimeParams): string | null => {
  const start = parse(startsAt)
  if (!start) return null
  const end = parse(endsAt)

  // All-day events store a UTC-midnight instant that represents a calendar
  // date, so they render in UTC to show that exact day (a reader west of UTC
  // would otherwise see the day before) and carry no clock and no zone.
  if (allDay) {
    const first = formatDay(start, 'UTC')
    if (!end || dayKey(end, 'UTC') === dayKey(start, 'UTC')) return first
    return `${first}${SEPARATOR}${formatDay(end, 'UTC')}`
  }

  // Timed events are stored as an instant and rendered in the reader's zone
  // (or the given one), with the zone named so the clock is never ambiguous.
  const startZone = formatZone(start, timeZone)
  const first = `${formatDay(start, timeZone)}, ${formatClock(start, timeZone)}`
  if (!end) return `${first} ${startZone}`

  const endZone = formatZone(end, timeZone)
  const last =
    dayKey(end, timeZone) === dayKey(start, timeZone)
      ? formatClock(end, timeZone)
      : `${formatDay(end, timeZone)}, ${formatClock(end, timeZone)}`
  // One label at the end, unless a daylight-saving change between the bounds
  // gives them different names — then each bound keeps its own.
  return startZone === endZone
    ? `${first}${SEPARATOR}${last} ${endZone}`
    : `${first} ${startZone}${SEPARATOR}${last} ${endZone}`
}
