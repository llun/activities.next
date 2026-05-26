import { Knex } from 'knex'

import { parseCounterValue } from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  GetInstanceActivityParams,
  InstanceActivityDatabase,
  InstanceActivityWeek
} from '@/lib/types/database/operations'

type SQLDatabase = Knex | Knex.Transaction

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const INSTANCE_ACTIVITY_WEEKS = 12

type ActivityCounterKey = 'statuses' | 'logins' | 'registrations'

type CounterRow = {
  id: string
  value: number | string | bigint | null
  bucketHour: Date | string | number | null
}

const COUNTER_TYPES: Record<string, ActivityCounterKey> = {
  'bucket:local-statuses:': 'statuses',
  'bucket:logins:': 'logins',
  'bucket:accounts:': 'registrations'
}
const COUNTER_TYPE_ENTRIES = Object.entries(COUNTER_TYPES)

const SQLITE_CLIENTS = new Set(['better-sqlite3', 'sqlite3'])

export const getUTCWeekStart = (date: Date): Date => {
  const day = date.getUTCDay()
  const daysSinceMonday = (day + 6) % 7

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysSinceMonday
    )
  )
}

const getWeekKey = (date: Date): string =>
  String(Math.floor(getUTCWeekStart(date).getTime() / 1000))

const getBucketCounterType = (id: string): ActivityCounterKey | null => {
  for (const [prefix, counterType] of COUNTER_TYPE_ENTRIES) {
    if (id.startsWith(prefix)) return counterType
  }

  return null
}

const isSQLiteClient = (database: Knex): boolean =>
  SQLITE_CLIENTS.has(String(database.client.config.client))

const formatUTCTimestamp = (date: Date, separator: ' ' | 'T'): string => {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  const s = String(date.getUTCSeconds()).padStart(2, '0')
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${y}-${mo}-${d}${separator}${h}:${mi}:${s}.${ms}`
}

const addBucketHourRangeFilter = (
  query: Knex.QueryBuilder<CounterRow, CounterRow[]>,
  database: Knex,
  start: Date,
  end: Date
): Knex.QueryBuilder<CounterRow, CounterRow[]> => {
  if (!isSQLiteClient(database)) {
    return query
      .andWhere('bucketHour', '>=', start)
      .andWhere('bucketHour', '<', end)
  }

  return query.andWhere((builder) => {
    builder
      .where((range) => {
        range
          .where('bucketHour', '>=', start.getTime())
          .andWhere('bucketHour', '<', end.getTime())
      })
      .orWhere((range) => {
        range
          .where('bucketHour', '>=', formatUTCTimestamp(start, ' '))
          .andWhere('bucketHour', '<', formatUTCTimestamp(end, ' '))
      })
      .orWhere((range) => {
        range
          .where('bucketHour', '>=', formatUTCTimestamp(start, 'T'))
          .andWhere('bucketHour', '<', formatUTCTimestamp(end, 'T'))
      })
      .orWhere((range) => {
        range
          .where('bucketHour', '>=', start.toISOString())
          .andWhere('bucketHour', '<', end.toISOString())
      })
  })
}

export const getInstanceActivityFromCounters = async (
  database: Knex,
  { now = new Date() }: GetInstanceActivityParams = {}
): Promise<InstanceActivityWeek[]> => {
  const newestWeekStart = getUTCWeekStart(now)
  const oldestWeekStart = new Date(
    newestWeekStart.getTime() - (INSTANCE_ACTIVITY_WEEKS - 1) * WEEK_MS
  )
  const newestWeekEnd = new Date(newestWeekStart.getTime() + WEEK_MS)

  const weeks = Array.from({ length: INSTANCE_ACTIVITY_WEEKS }, (_, index) => {
    const weekStart = new Date(newestWeekStart.getTime() - index * WEEK_MS)
    return {
      weekStart,
      weekKey: String(Math.floor(weekStart.getTime() / 1000)),
      statuses: 0,
      logins: 0,
      registrations: 0
    }
  })
  const weekByKey = new Map(weeks.map((week) => [week.weekKey, week]))

  const query = database<CounterRow>('counters').whereNotNull('bucketHour')
  const rows = await addBucketHourRangeFilter(
    query,
    database,
    oldestWeekStart,
    newestWeekEnd
  )
    .andWhere((builder) => {
      builder
        .where('id', 'like', 'bucket:local-statuses:%')
        .orWhere('id', 'like', 'bucket:logins:%')
        .orWhere('id', 'like', 'bucket:accounts:%')
    })
    .select('id', 'value', 'bucketHour')

  for (const row of rows) {
    const counterType = getBucketCounterType(row.id)
    if (!counterType || row.bucketHour === null) continue

    const bucketHour =
      row.bucketHour instanceof Date
        ? row.bucketHour
        : new Date(getCompatibleTime(row.bucketHour))
    if (Number.isNaN(bucketHour.getTime())) continue

    if (bucketHour < oldestWeekStart || bucketHour >= newestWeekEnd) continue

    const week = weekByKey.get(getWeekKey(bucketHour))
    if (!week) continue

    week[counterType] += parseCounterValue(row.value)
  }

  return weeks.map(({ weekKey, statuses, logins, registrations }) => ({
    week: weekKey,
    statuses: String(statuses),
    logins: String(logins),
    registrations: String(registrations)
  }))
}

export const getWeeklyLoginMarkerId = (accountId: string): string =>
  `unique-login:${accountId}`

export const recordWeeklyLogin = async (
  database: SQLDatabase,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  if (!accountId) return

  const markerId = getWeeklyLoginMarkerId(accountId)
  const weekKey = Number(getWeekKey(currentTime))

  await database('counters')
    .insert({
      id: markerId,
      value: 0,
      bucketHour: null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict('id')
    .ignore()

  const marked = await database('counters')
    .where('id', markerId)
    .andWhere((builder) => {
      builder.whereNull('value').orWhere('value', '<', weekKey)
    })
    .update({
      value: weekKey,
      updatedAt: currentTime
    })

  if (marked > 0) {
    await incrementBucket(database, 'logins', 1, currentTime)
  }
}

export const recordWeeklyLoginSafely = async (
  database: SQLDatabase,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  try {
    await recordWeeklyLogin(database, accountId, currentTime)
  } catch (error) {
    console.error('Failed to record weekly login', error)
  }
}

export const incrementLocalStatusBucket = async (
  database: SQLDatabase,
  currentTime = new Date()
): Promise<void> => {
  await incrementBucket(database, 'local-statuses', 1, currentTime)
}

export const InstanceActivitySQLDatabaseMixin = (
  database: Knex
): InstanceActivityDatabase => ({
  getInstanceActivity(params?: GetInstanceActivityParams) {
    return getInstanceActivityFromCounters(database, params)
  }
})
