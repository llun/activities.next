import type {
  GetInstanceActivityParams,
  GetInstancePeersParams,
  InstanceActivityWeek
} from '@/lib/database/domains/instanceActivity/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import { parseCounterValue } from '@/lib/database/sql/utils/counter'
import { formatBucketHour } from '@/lib/database/sql/utils/counterBucket'
import { logger } from '@/lib/utils/logger'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const INSTANCE_ACTIVITY_WEEKS = 12

type ActivityCounterKey = 'statuses' | 'logins' | 'registrations'

const COUNTER_TYPES: Record<string, ActivityCounterKey> = {
  'bucket:local-statuses:': 'statuses',
  'bucket:logins:': 'logins',
  'bucket:accounts:': 'registrations'
}
const COUNTER_TYPE_ENTRIES = Object.entries(COUNTER_TYPES)
const COUNTER_TYPE_PREFIXES = Object.keys(COUNTER_TYPES)

const getUTCWeekStart = (date: Date): Date => {
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

export const getInstanceActivity = async (
  db: Db,
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

  // Bucket ids end in a sortable YYYYMMDDHH, so an id range per counter type
  // narrows the rows in the database. A row with no bucketHour is not a
  // bucket, and a bucketHour outside the 12 weeks has no week below.
  const rows = await db
    .selectFrom('counters')
    .select(['id', 'value', 'bucketHour'])
    .where((eb) =>
      eb.or(
        COUNTER_TYPE_PREFIXES.map((prefix) =>
          eb.and([
            eb('id', '>=', `${prefix}${oldestHourKey}`),
            eb('id', '<', `${prefix}${newestHourKey}`)
          ])
        )
      )
    )
    .execute()

  for (const row of rows) {
    const counterType = getBucketCounterType(row.id)
    if (!counterType || row.bucketHour === null) continue

    const week = weekByKey.get(getWeekKey(new Date(row.bucketHour)))
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

export const recordWeeklyLogin = async (
  db: Db,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  if (!accountId) return

  await inTransaction(db, async (trx) => {
    const markerId = `unique-login:${accountId}`
    const weekKey = Number(getWeekKey(currentTime))

    await trx
      .insertInto('counters')
      .values({
        id: markerId,
        value: 0,
        bucketHour: null,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()

    // The marker holds the week of the last counted login; only the first
    // login of a week moves it (and counts), however often or concurrently the
    // account logs in.
    const { numUpdatedRows } = await trx
      .updateTable('counters')
      .set({ value: weekKey, updatedAt: currentTime })
      .where('id', '=', markerId)
      .where('value', '<', weekKey)
      .executeTakeFirst()

    if (Number(numUpdatedRows) > 0) {
      await incrementBucket(trx, 'logins', 1, currentTime)
    }
  })
}

export const recordWeeklyLoginSafely = async (
  db: Db,
  accountId: string | null | undefined,
  currentTime = new Date()
): Promise<void> => {
  try {
    await recordWeeklyLogin(db, accountId, currentTime)
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

export const incrementLocalStatusBucket = (
  db: Db,
  currentTime = new Date()
): Promise<void> => incrementBucket(db, 'local-statuses', 1, currentTime)

export const getInstancePeers = async (
  db: Db,
  params?: GetInstancePeersParams
): Promise<string[]> => {
  const localDomain = params?.localDomain ?? ''
  // Actors store the bare host in `domain`; a configured host may include a
  // scheme (e.g. `https://example.com`). Normalize so self is excluded.
  const normalizedLocalDomain = localDomain.includes('://')
    ? new URL(localDomain).host
    : localDomain
  const rows = await db
    .selectFrom('actors')
    .select('domain')
    .distinct()
    .where('domain', '<>', '')
    .where('domain', '<>', normalizedLocalDomain)
    .orderBy('domain', 'asc')
    .execute()

  // Both comparisons are false for a NULL domain, so every row has one.
  return rows.map((row) => row.domain as string)
}

export const getInstanceAdminActorId = async (
  db: Db
): Promise<string | null> => {
  // Remote actors have a null accountId, so the inner join naturally limits
  // the lookup to local actors. Earliest-created wins so the contact account
  // is stable across requests.
  const row = await db
    .selectFrom('actors')
    .innerJoin('accounts', 'accounts.id', 'actors.accountId')
    .select('actors.id')
    .where('accounts.role', '=', 'admin')
    .where('actors.deletionStatus', 'is', null)
    .orderBy('actors.createdAt', 'asc')
    .limit(1)
    .executeTakeFirst()

  return row?.id ?? null
}

// The facade getSQLDatabase binds with bindDb().
export const instanceActivityQueries = {
  getInstanceActivity,
  getInstancePeers,
  getInstanceAdminActorId
}
