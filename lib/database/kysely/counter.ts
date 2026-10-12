import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { parseCounterValue } from '@/lib/database/utils/counter'

// The `counters` helpers. An adjustment is one upsert, which the database
// applies atomically (PostgreSQL and SQLite both take the row lock for ON
// CONFLICT DO UPDATE):
// - a missing row is created as if it held 0 and then adjusted;
// - the new value is clamped to 0..Number.MAX_SAFE_INTEGER, the range
//   parseCounterValue (lib/database/utils/counter.ts) reads back;
// - updatedAt is set to `currentTime` on every adjustment, createdAt only when
//   the row is created;
// - bucketHour is left alone (bucket rows are written by counterBucket.ts).

const MAX_COUNTER_VALUE = Number.MAX_SAFE_INTEGER

const clampForInsert = (delta: number) =>
  Math.min(Math.max(0, Math.trunc(delta)), MAX_COUNTER_VALUE)

export const getCounterValue = async (db: Db, id: string): Promise<number> => {
  const row = await db
    .selectFrom('counters')
    .select('value')
    .where('id', '=', id)
    .executeTakeFirst()
  return parseCounterValue(row?.value)
}

/**
 * The values of the counters among `ids`, keyed by id. A missing counter has
 * no entry. Runs one statement, so a caller with a long list splits it first.
 */
export const getCounterValues = async (
  db: Db,
  ids: string[]
): Promise<Record<string, number>> => {
  if (ids.length === 0) return {}

  const rows = await db
    .selectFrom('counters')
    .select(['id', 'value'])
    .where('id', 'in', ids)
    .execute()
  return Object.fromEntries(
    rows.map((row) => [row.id, parseCounterValue(row.value)])
  )
}

/**
 * Sets the counter to `value` (clamped to 0..Number.MAX_SAFE_INTEGER and
 * truncated; a non-finite value is 0), creating the
 * row when it is missing. updatedAt is `currentTime` either way, createdAt only
 * on create; bucketHour is left alone.
 */
export const setCounterValue = async (
  db: Db,
  id: string,
  value: number,
  currentTime = new Date()
): Promise<void> => {
  const nextValue = Number.isFinite(value) ? clampForInsert(value) : 0
  await db
    .insertInto('counters')
    .values({
      id,
      value: nextValue,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        value: nextValue,
        updatedAt: currentTime
      })
    )
    .execute()
}

export const adjustCounterValue = async (
  db: Db,
  id: string,
  delta: number,
  currentTime = new Date()
): Promise<void> => {
  const step = Math.trunc(delta)
  if (step === 0) return

  await db
    .insertInto('counters')
    .values({
      id,
      value: clampForInsert(step),
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet((eb) => {
        const next = sql<number>`${eb.ref('counters.value')} + ${step}`
        return {
          value: sql<number>`case when ${next} < 0 then 0 when ${next} > ${MAX_COUNTER_VALUE} then ${MAX_COUNTER_VALUE} else ${next} end`,
          updatedAt: currentTime
        }
      })
    )
    .execute()
}

export const increaseCounterValue = (
  db: Db,
  id: string,
  amount = 1,
  currentTime = new Date()
) => adjustCounterValue(db, id, Math.abs(amount), currentTime)

export const decreaseCounterValue = (
  db: Db,
  id: string,
  amount = 1,
  currentTime = new Date()
) => adjustCounterValue(db, id, -Math.abs(amount), currentTime)

/** Deletes the counter `id`; a missing one is no error. */
export const deleteCounterValue = async (db: Db, id: string): Promise<void> => {
  await db.deleteFrom('counters').where('id', '=', id).execute()
}

/**
 * Deletes the counters among `ids`, in statements of as many ids as one
 * `in (…)` list may hold. Runs nothing for an empty list.
 */
export const deleteCounterValues = async (
  db: Db,
  ids: string[]
): Promise<void> => {
  if (ids.length === 0) return

  for (const idChunk of chunkArray(ids, getWhereInBatchSize(db))) {
    await db.deleteFrom('counters').where('id', 'in', idChunk).execute()
  }
}
