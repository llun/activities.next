import { z } from 'zod'

import {
  DateKey,
  NAMED_TIME_ZONE_PATTERN,
  canonicalTimeZone,
  compareDateKeys,
  dateKeyParts,
  isValidTimeZone,
  localDayWindow,
  parseDateKey
} from '@/lib/fitness/calendar/localDay'

import { ActivityTypeParam } from './queryParams'

/**
 * The query contract shared by the fitness overview's reads: the summary, the
 * calendar and the day details.
 *
 * The client sends calendar days and its IANA zone, never instants. The server
 * turns them into one half-open instant window with `localDayWindow`, the same
 * function the database buckets days with, so all three reads agree on which
 * activities belong to a day.
 *
 * Every schema here is meant for `safeParse`: a malformed or impossible value
 * is a validation issue, so the route answers 400 rather than throwing.
 */

const MAX_TIME_ZONE_LENGTH = 64

const MIN_DATE_YEAR = 1970

export const DEFAULT_DAY_ACTIVITIES_LIMIT = 20
export const MAX_DAY_ACTIVITIES_LIMIT = 50

/** A named IANA zone, returned in its canonical spelling. */
export const TimeZoneParam = z
  .string()
  .max(MAX_TIME_ZONE_LENGTH)
  .regex(NAMED_TIME_ZONE_PATTERN, 'Expected a named IANA time zone')
  .refine(isValidTimeZone, 'Unknown time zone')
  .transform((value) => canonicalTimeZone(value))

/** A real `YYYY-MM-DD` calendar date from 1970 on. */
export const DateKeyParam = z.string().transform((value, context): DateKey => {
  const key = parseDateKey(value)
  if (!key || dateKeyParts(key).year < MIN_DATE_YEAR) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a calendar date as YYYY-MM-DD from 1970 on'
    })
    return z.NEVER
  }
  return key
})

/**
 * The instant window for the local days `from` to `to`, or a validation issue
 * when the window cannot be built (a date at the very end of year 9999 has no
 * next day to end on).
 */
const toWindow = (
  from: DateKey,
  to: DateKey,
  timeZone: string,
  context: z.RefinementCtx
) => {
  try {
    return localDayWindow(from, to, timeZone)
  } catch {
    context.addIssue({ code: 'custom', message: 'Date is out of range' })
    return null
  }
}

export interface FitnessCalendarRange {
  from: DateKey
  /** Inclusive. */
  to: DateKey
  timeZone: string
  /** Inclusive start instant, epoch milliseconds. */
  startMs: number
  /** Exclusive end instant, epoch milliseconds. */
  endMs: number
}

const rangeShape = {
  from: DateKeyParam,
  to: DateKeyParam,
  time_zone: TimeZoneParam
}

const toRange = (
  value: { from: DateKey; to: DateKey; time_zone: string },
  context: z.RefinementCtx
): FitnessCalendarRange | null => {
  if (compareDateKeys(value.from, value.to) > 0) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'Must not be before from'
    })
    return null
  }
  const window = toWindow(value.from, value.to, value.time_zone, context)
  if (!window) return null
  return {
    from: value.from,
    to: value.to,
    timeZone: value.time_zone,
    ...window
  }
}

/**
 * `from=YYYY-MM-DD&to=YYYY-MM-DD&time_zone=<IANA>`, with `to` inclusive. There
 * is deliberately no minimum span: the 7-day rule for custom ranges belongs to
 * the client's range validator, and the This month and Year to date presets
 * must load on their first day.
 */
export const FitnessCalendarRangeQuery = z
  .object(rangeShape)
  .transform(
    (value, context): FitnessCalendarRange => toRange(value, context) ?? z.NEVER
  )

export interface FitnessCalendarQueryValue extends FitnessCalendarRange {
  activityType?: string
}

/** The range query plus the calendar's optional `activity_type` filter. */
export const FitnessCalendarQuery = z
  .object({
    ...rangeShape,
    activity_type: ActivityTypeParam.max(255).optional()
  })
  .transform((value, context): FitnessCalendarQueryValue => {
    const range = toRange(value, context)
    if (!range) return z.NEVER
    return { ...range, activityType: value.activity_type || undefined }
  })

// Paging values are clamped rather than rejected, like the gear activities
// route: an odd limit is a client bug, not a reason to fail the read.
const parseInteger = (value: string | undefined) => {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const LimitParam = z
  .string()
  .optional()
  .transform((value) => {
    const parsed = parseInteger(value)
    if (parsed === null) return DEFAULT_DAY_ACTIVITIES_LIMIT
    return Math.min(MAX_DAY_ACTIVITIES_LIMIT, Math.max(1, parsed))
  })

const OffsetParam = z
  .string()
  .optional()
  .transform((value) => Math.max(0, parseInteger(value) ?? 0))

export interface FitnessCalendarDayQueryValue {
  date: DateKey
  timeZone: string
  startMs: number
  endMs: number
  limit: number
  offset: number
}

/** `date=YYYY-MM-DD&time_zone=<IANA>&limit&offset` for one local day. */
export const FitnessCalendarDayQuery = z
  .object({
    date: DateKeyParam,
    time_zone: TimeZoneParam,
    limit: LimitParam,
    offset: OffsetParam
  })
  .transform((value, context): FitnessCalendarDayQueryValue => {
    const window = toWindow(value.date, value.date, value.time_zone, context)
    if (!window) return z.NEVER
    return {
      date: value.date,
      timeZone: value.time_zone,
      limit: value.limit,
      offset: value.offset,
      ...window
    }
  })

/**
 * The `{ error }` message for a rejected query: the first problem, named by
 * its parameter, so a client bug is diagnosable from the response alone.
 */
export const describeCalendarQueryError = (error: z.ZodError): string => {
  const issue = error.issues[0]
  if (!issue) return 'Invalid query'
  const name = issue.path.map(String).join('.')
  return name ? `Invalid ${name}: ${issue.message}` : issue.message
}
