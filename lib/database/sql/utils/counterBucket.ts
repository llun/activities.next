import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue
} from './counter'

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
 * Adjust a bucket counter by delta (positive or negative) for the hour
 * containing currentTime. Also sets the bucketHour column on the row.
 */
export const adjustBucket = async (
  database: SQLDatabase,
  counterType: string,
  delta: number,
  currentTime = new Date()
): Promise<void> => {
  if (delta === 0) return

  const bucketHour = truncateToHour(currentTime)
  const hour = formatBucketHour(bucketHour)
  const id = CounterKey.bucketKey(counterType, hour)

  if (delta > 0) {
    await increaseCounterValue(database, id, delta, currentTime)
  } else {
    await decreaseCounterValue(database, id, Math.abs(delta), currentTime)
  }

  // Ensure the bucketHour column is set (it's NULL for rows created by the
  // generic counter helpers). Use a targeted update so we don't overwrite value.
  await (database as Knex)('counters')
    .where('id', id)
    .whereNull('bucketHour')
    .update({ bucketHour })
}

export const incrementBucket = (
  database: SQLDatabase,
  counterType: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> => adjustBucket(database, counterType, amount, currentTime)

export const decrementBucket = (
  database: SQLDatabase,
  counterType: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> => adjustBucket(database, counterType, -amount, currentTime)

export interface BucketStatRow {
  bucketHour: Date
  value: number
}

/**
 * Fetch all bucket rows for a counter type within [startTime, endTime].
 * Results are sorted by bucketHour ascending.
 */
export const getBucketStats = async (
  database: Knex,
  counterType: string,
  startTime: Date,
  endTime: Date
): Promise<BucketStatRow[]> => {
  const rows = await database('counters')
    .where('id', 'like', `bucket:${counterType}:%`)
    .whereNotNull('bucketHour')
    .andWhere('bucketHour', '>=', startTime)
    .andWhere('bucketHour', '<=', endTime)
    .orderBy('bucketHour', 'asc')
    .select('bucketHour', 'value')

  return rows.map((row) => ({
    bucketHour:
      row.bucketHour instanceof Date
        ? row.bucketHour
        : new Date(row.bucketHour),
    value:
      typeof row.value === 'number'
        ? row.value
        : parseInt(String(row.value ?? '0'), 10)
  }))
}
