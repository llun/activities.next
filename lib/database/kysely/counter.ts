import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { parseCounterValue } from '@/lib/database/sql/utils/counter'

// Kysely counterparts of the `counters` helpers in
// lib/database/sql/utils/counter.ts, for domains that have moved to Kysely.
// The Knex helpers stay for the domains that have not.
//
// The Knex version adjusts a counter with insert-ignore, a read, and a
// compare-and-swap update retried on conflict. Here it is one upsert, which
// the database applies atomically (PostgreSQL and SQLite both take the row
// lock for ON CONFLICT DO UPDATE), with the same result:
// - a missing row is created as if it held 0 and then adjusted;
// - the new value is clamped to 0..Number.MAX_SAFE_INTEGER, as
//   clampCounterValue does;
// - updatedAt is set to `currentTime` on every adjustment, createdAt only when
//   the row is created;
// - bucketHour is left alone (bucket rows are written by counterBucket.ts).
// MySQL would need ON DUPLICATE KEY UPDATE instead; it is not supported by
// the Kysely layer yet.

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
