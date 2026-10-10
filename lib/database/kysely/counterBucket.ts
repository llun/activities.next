import type { Db } from '@/lib/database/kysely'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import {
  formatBucketHour,
  truncateToHour
} from '@/lib/database/sql/utils/counterBucket'

// Kysely counterpart of incrementBucket in
// lib/database/sql/utils/counterBucket.ts, for domains that have moved to
// Kysely; the Knex helper stays for the ones that have not. Both write the same
// `counters` rows. getBucketStats reads them back for the admin dashboard.

/**
 * Increment the bucket counter for the hour containing `currentTime`. Buckets
 * are increment-only: they track creation activity per hour, and deletions are
 * handled by the global service counters.
 */
export const incrementBucket = async (
  db: Db,
  counterType: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> => {
  if (amount <= 0) return

  const bucketHour = truncateToHour(currentTime)
  const id = CounterKey.bucketKey(counterType, formatBucketHour(bucketHour))

  await increaseCounterValue(db, id, amount, currentTime)

  // bucketHour is NULL on a row the generic counter helpers created; set it
  // once and leave an existing value alone.
  await db
    .updateTable('counters')
    .set({ bucketHour, updatedAt: currentTime })
    .where('id', '=', id)
    .where('bucketHour', 'is', null)
    .execute()
}

export type BucketStat = {
  /** Start of the hour, as epoch milliseconds. */
  bucketHour: number
  value: number
}

/**
 * The `counterType` buckets whose hour lies within `[startTime, endTime]`
 * (both ends included), oldest hour first.
 */
export const getBucketStats = (
  db: Db,
  counterType: string,
  startTime: Date,
  endTime: Date
): Promise<BucketStat[]> =>
  db
    .selectFrom('counters')
    // Only a bucket row has a bucketHour; a NULL one fails both comparisons.
    .select((eb) => [eb.ref('bucketHour').$notNull().as('bucketHour'), 'value'])
    .where('id', 'like', `${CounterKey.bucketKey(counterType, '')}%`)
    .where('bucketHour', '>=', timestampValue(startTime))
    .where('bucketHour', '<=', timestampValue(endTime))
    .orderBy('bucketHour', 'asc')
    .execute()
