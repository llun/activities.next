import { withKnexPaging } from '@/lib/database/domains/fitnessFile/rows'
import type {
  GetActorHasFitnessDataParams,
  GetFitnessActivitiesInWindowParams,
  GetFitnessActivityCalendarDataParams,
  GetFitnessActivitySummaryParams,
  GetFitnessActivityTimeBoundsParams
} from '@/lib/database/domains/fitnessFile/types'
import type { Db } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import { actorVisibleStatusIds } from '@/lib/database/kysely/visibility/actorVisible'
import {
  bucketByLocalDay,
  isValidTimeZone
} from '@/lib/fitness/calendar/localDay'
import type {
  FitnessActivitySummary,
  FitnessActivityTimeBounds,
  FitnessCalendarDay,
  FitnessWindowActivity,
  FitnessWindowActivityPage
} from '@/lib/fitness/calendar/types'

// The fitness overview's reads: the summary, the calendar, a window's
// activities, the earliest activity, and whether an actor has any fitness
// data to show.

// Defensive ceiling for one page of `getFitnessActivitiesInWindow`; the route
// clamps lower, this only stops a caller asking for an unbounded page.
const MAX_WINDOW_PAGE_SIZE = 100

/**
 * The one predicate behind the fitness overview's summary, calendar and day
 * details: the actor's countable activities (primary, completed, not deleted)
 * that started in the half-open instant window `[startDate, endDate)`.
 *
 * It is deliberately the only place the three reads get their rows from, so a
 * day's calendar entry, that day's details and the summary can never disagree
 * about what counts. The range is a plain comparison on `activityStartTime`, with
 * no date function and no time zone, so it behaves the same on SQLite (epoch
 * milliseconds) and PostgreSQL (`timestamptz`).
 */
const countableActivitiesInWindow = (
  db: Db,
  {
    actorId,
    startDate,
    endDate
  }: { actorId: string; startDate: number; endDate: number }
) =>
  db
    .selectFrom('fitness_files')
    .where((eb) => countableActivity(eb))
    .where('fitness_files.actorId', '=', actorId)
    .where('fitness_files.activityStartTime', 'is not', null)
    .where('fitness_files.activityStartTime', '>=', timestampValue(startDate))
    .where('fitness_files.activityStartTime', '<', timestampValue(endDate))

export const getFitnessActivitySummary = async (
  db: Db,
  { actorId, startDate, endDate }: GetFitnessActivitySummaryParams
): Promise<FitnessActivitySummary[]> => {
  // No `activityType` filter: an untyped activity is counted, as its own
  // group, so the totals equal the calendar's sum for the same window.
  const rows = await countableActivitiesInWindow(db, {
    actorId,
    startDate,
    endDate
  })
    .groupBy('fitness_files.activityType')
    .select((eb) => [
      'fitness_files.activityType as activityType',
      eb.fn.countAll().as('count'),
      eb.fn
        .coalesce(eb.fn.sum('fitness_files.totalDistanceMeters'), eb.lit(0))
        .as('totalDistanceMeters'),
      eb.fn
        .coalesce(eb.fn.sum('fitness_files.totalDurationSeconds'), eb.lit(0))
        .as('totalDurationSeconds'),
      eb.fn
        .coalesce(eb.fn.sum('fitness_files.elevationGainMeters'), eb.lit(0))
        .as('totalElevationGainMeters')
    ])
    .execute()

  // Aggregates carry no declared type on SQLite, so they are converted here.
  return rows.map((row) => ({
    // `null` stays `null`: `String(null)` would invent a "null" type.
    activityType:
      row.activityType === null || row.activityType === undefined
        ? null
        : String(row.activityType),
    count: Number(row.count),
    totalDistanceMeters: Number(row.totalDistanceMeters),
    totalDurationSeconds: Number(row.totalDurationSeconds),
    totalElevationGainMeters: Number(row.totalElevationGainMeters)
  }))
}

export const getActorHasFitnessData = async (
  db: Db,
  { actorId, ...audience }: GetActorHasFitnessDataParams
): Promise<boolean> => {
  // The same status-visibility set the profile's posts and media use, so the
  // Fitness tab is offered to exactly the viewers who could see a fitness
  // post in it. `null` is the deliberate unfiltered (owner) audience.
  const visibleStatusIds = actorVisibleStatusIds(db, actorId, audience)

  const row = await db
    .selectFrom('fitness_files')
    .select((eb) => eb.lit(1).as('one'))
    .where('actorId', '=', actorId)
    .where('processingStatus', '=', 'completed')
    .where('isPrimary', '=', true)
    .where('deletedAt', 'is', null)
    .where('activityType', 'is not', null)
    .where('activityStartTime', 'is not', null)
    .$if(visibleStatusIds !== null, (qb) =>
      qb.where('fitness_files.statusId', 'in', visibleStatusIds!)
    )
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const getFitnessActivityCalendarData = async (
  db: Db,
  {
    actorId,
    startDate,
    endDate,
    timeZone,
    activityType
  }: GetFitnessActivityCalendarDataParams
): Promise<FitnessCalendarDay[]> => {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Invalid time zone: ${JSON.stringify(timeZone)}`)
  }

  // The range filter is the only SQL that touches time, and it is the same on
  // every backend. Days are bucketed here, by the same `startOfLocalDay` that
  // built the window, so a row lands in the day a day-details read for that
  // date would return it from.
  const rows = await countableActivitiesInWindow(db, {
    actorId,
    startDate,
    endDate
  })
    .$if(Boolean(activityType), (qb) =>
      qb.where('fitness_files.activityType', '=', activityType!)
    )
    .select([
      'fitness_files.activityStartTime',
      'fitness_files.totalDistanceMeters',
      'fitness_files.totalDurationSeconds',
      'fitness_files.elevationGainMeters'
    ])
    .orderBy('fitness_files.activityStartTime', 'asc')
    .orderBy('fitness_files.id', 'asc')
    .execute()

  const timed = rows.map((row) => ({
    // Never null: the window filter requires a start time.
    ms: Number(row.activityStartTime),
    distance: Number(row.totalDistanceMeters ?? 0),
    duration: Number(row.totalDurationSeconds ?? 0),
    elevation: Number(row.elevationGainMeters ?? 0)
  }))

  return bucketByLocalDay(timed, timeZone, (row) => row.ms).map(
    ({ date, rows: dayRows }) => ({
      date,
      count: dayRows.length,
      totalDistanceMeters: dayRows.reduce((sum, row) => sum + row.distance, 0),
      totalDurationSeconds: dayRows.reduce((sum, row) => sum + row.duration, 0),
      totalElevationGainMeters: dayRows.reduce(
        (sum, row) => sum + row.elevation,
        0
      )
    })
  )
}

export const getFitnessActivitiesInWindow = async (
  db: Db,
  {
    actorId,
    startDate,
    endDate,
    limit,
    offset
  }: GetFitnessActivitiesInWindowParams
): Promise<FitnessWindowActivityPage> => {
  const pageSize = Math.min(
    MAX_WINDOW_PAGE_SIZE,
    Math.max(1, Math.floor(limit))
  )
  const skip = Math.max(0, Math.floor(offset))

  // One row past the page answers `hasMore` without a second COUNT query.
  const query = countableActivitiesInWindow(db, { actorId, startDate, endDate })
    .select([
      'fitness_files.id',
      'fitness_files.statusId',
      'fitness_files.activityType',
      'fitness_files.activityStartTime',
      'fitness_files.totalDistanceMeters',
      'fitness_files.totalDurationSeconds',
      'fitness_files.elevationGainMeters',
      'fitness_files.description',
      'fitness_files.fileName'
    ])
    .orderBy('fitness_files.activityStartTime', 'asc')
    .orderBy('fitness_files.id', 'asc')
  const rows = await withKnexPaging(db, query, {
    limit: pageSize + 1,
    offset: skip
  }).execute()

  const toNumberOrNull = (value: unknown) =>
    value === null || value === undefined ? null : Number(value)

  return {
    activities: rows.slice(0, pageSize).map((row): FitnessWindowActivity => ({
      id: String(row.id),
      statusId: row.statusId ? String(row.statusId) : null,
      activityType: row.activityType ? String(row.activityType) : null,
      // Never null: the window filter requires a start time.
      startTime: Number(row.activityStartTime),
      totalDistanceMeters: toNumberOrNull(row.totalDistanceMeters),
      totalDurationSeconds: toNumberOrNull(row.totalDurationSeconds),
      elevationGainMeters: toNumberOrNull(row.elevationGainMeters),
      description: row.description ? String(row.description) : null,
      fileName: String(row.fileName)
    })),
    hasMore: rows.length > pageSize
  }
}

export const getFitnessActivityTimeBounds = async (
  db: Db,
  { actorId }: GetFitnessActivityTimeBoundsParams
): Promise<FitnessActivityTimeBounds> => {
  const row = await db
    .selectFrom('fitness_files')
    .select((eb) => eb.fn.min('fitness_files.activityStartTime').as('earliest'))
    .where((eb) => countableActivity(eb))
    .where('fitness_files.actorId', '=', actorId)
    .where('fitness_files.activityStartTime', 'is not', null)
    .limit(1)
    .executeTakeFirst()

  // MIN of a timestamp keeps its type on PostgreSQL, so the driver hands back
  // epoch milliseconds; on SQLite it is the stored value as is.
  return { earliest: toEpochMilliseconds(row?.earliest) }
}

export const fitnessFileOverviewQueries = {
  getFitnessActivitySummary,
  getActorHasFitnessData,
  getFitnessActivityCalendarData,
  getFitnessActivitiesInWindow,
  getFitnessActivityTimeBounds
}
