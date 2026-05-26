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
  for (const [prefix, counterType] of Object.entries(COUNTER_TYPES)) {
    if (id.startsWith(prefix)) return counterType
  }

  return null
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

  const rows = await database<CounterRow>('counters')
    .whereNotNull('bucketHour')
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

export const getWeeklyLoginMarkerId = (
  accountId: string,
  currentTime = new Date()
): string => `unique-login:${getWeekKey(currentTime)}:${accountId}`

export const recordWeeklyLogin = async (
  database: SQLDatabase,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  if (!accountId) return

  const markerId = getWeeklyLoginMarkerId(accountId, currentTime)

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
    .andWhere('value', 0)
    .update({
      value: 1,
      updatedAt: currentTime
    })

  if (marked > 0) {
    await incrementBucket(database, 'logins', 1, currentTime)
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
