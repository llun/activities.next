import { Knex } from 'knex'

import { parseCounterValue } from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  GetInstanceActivityParams,
  GetInstancePeersParams,
  InstanceActivityDatabase,
  InstanceActivityWeek
} from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

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
const COUNTER_TYPE_PREFIXES = Object.keys(COUNTER_TYPES)

const isTransaction = (database: SQLDatabase): database is Knex.Transaction =>
  Boolean((database as { isTransaction?: boolean }).isTransaction)

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

const formatBucketHour = (date: Date): string => {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}${mo}${d}${h}`
}

const getBucketCounterType = (id: string): ActivityCounterKey | null => {
  for (const [prefix, counterType] of COUNTER_TYPE_ENTRIES) {
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
  const oldestHourKey = formatBucketHour(oldestWeekStart)
  const newestHourKey = formatBucketHour(newestWeekEnd)

  const rows = await database<CounterRow>('counters')
    .whereNotNull('bucketHour')
    .andWhere((builder) => {
      for (const prefix of COUNTER_TYPE_PREFIXES) {
        builder.orWhere((range) => {
          range
            .where('id', '>=', `${prefix}${oldestHourKey}`)
            .andWhere('id', '<', `${prefix}${newestHourKey}`)
        })
      }
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

const recordWeeklyLoginWithinTransaction = async (
  database: SQLDatabase,
  accountId: string,
  currentTime: Date
): Promise<void> => {
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

export const recordWeeklyLogin = async (
  database: SQLDatabase,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  if (!accountId) return

  if (isTransaction(database)) {
    await recordWeeklyLoginWithinTransaction(database, accountId, currentTime)
    return
  }

  await database.transaction(async (trx) => {
    await recordWeeklyLoginWithinTransaction(trx, accountId, currentTime)
  })
}

export const recordWeeklyLoginSafely = async (
  database: SQLDatabase,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  try {
    await recordWeeklyLogin(database, accountId, currentTime)
  } catch (error) {
    logger.error(
      {
        err: error,
        accountId,
        currentTime: currentTime.toISOString()
      },
      'Failed to record weekly login'
    )
  }
}

export const incrementLocalStatusBucket = async (
  database: SQLDatabase,
  currentTime = new Date()
): Promise<void> => {
  await incrementBucket(database, 'local-statuses', 1, currentTime)
}

export const getInstancePeersFromActors = async (
  database: Knex,
  { localDomain }: GetInstancePeersParams
): Promise<string[]> => {
  // Actors store the bare host in `domain`; a configured host may include a
  // scheme (e.g. `https://example.com`). Normalize so self is excluded.
  const normalizedLocalDomain = localDomain.includes('://')
    ? new URL(localDomain).host
    : localDomain
  const rows = await database('actors')
    .distinct('domain')
    .whereNotNull('domain')
    .andWhereNot('domain', '')
    .andWhereNot('domain', normalizedLocalDomain)
    .orderBy('domain', 'asc')
    .pluck('domain')

  return rows.filter((domain): domain is string => Boolean(domain))
}

export const getInstanceAdminActorIdFromAccounts = async (
  database: Knex
): Promise<string | null> => {
  // Remote actors have a null accountId, so the inner join naturally limits
  // the lookup to local actors. Earliest-created wins so the contact account
  // is stable across requests.
  const row = await database('actors')
    .join('accounts', 'actors.accountId', 'accounts.id')
    .where('accounts.role', 'admin')
    .whereNull('actors.deletionStatus')
    .orderBy('actors.createdAt', 'asc')
    .first<{ id: string } | undefined>('actors.id as id')

  return row?.id ?? null
}

export const InstanceActivitySQLDatabaseMixin = (
  database: Knex
): InstanceActivityDatabase => ({
  getInstanceActivity(params?: GetInstanceActivityParams) {
    return getInstanceActivityFromCounters(database, params)
  },
  getInstancePeers(params?: GetInstancePeersParams) {
    return getInstancePeersFromActors(database, {
      localDomain: params?.localDomain ?? ''
    })
  },
  getInstanceAdminActorId() {
    return getInstanceAdminActorIdFromAccounts(database)
  }
})
