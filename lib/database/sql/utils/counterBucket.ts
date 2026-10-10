import { Knex } from 'knex'

import { CounterKey, increaseCounterValue } from './counter'

export type SQLDatabase = Knex | Knex.Transaction

/** Format a Date to the compact hour key used in bucket counter ids: 'YYYYMMDDHH' */
export const formatBucketHour = (date: Date): string => {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}${mo}${d}${h}`
}

/** Truncate a Date to the start of its UTC hour */
export const truncateToHour = (date: Date): Date => {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours()
    )
  )
}

/**
 * Increment a bucket counter for the hour containing currentTime.
 * Buckets are increment-only — they track creation activity per hour.
 * Deletions are handled by the global service counters, not buckets.
 */
export const incrementBucket = async (
  database: SQLDatabase,
  counterType: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> => {
  if (amount <= 0) return

  const bucketHour = truncateToHour(currentTime)
  const hour = formatBucketHour(bucketHour)
  const id = CounterKey.bucketKey(counterType, hour)

  await increaseCounterValue(database, id, amount, currentTime)

  // Ensure the bucketHour column is set (it's NULL for rows created by the
  // generic counter helpers).
  await database('counters')
    .where('id', id)
    .whereNull('bucketHour')
    .update({ bucketHour, updatedAt: currentTime })
}
