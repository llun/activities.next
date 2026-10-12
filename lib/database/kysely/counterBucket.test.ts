import type { Db } from '@/lib/database/kysely'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import {
  getBucketStats,
  incrementBucket
} from '@/lib/database/kysely/counterBucket'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// The hour-bucket counters, on SQLite and, under TEST_DATABASE_TYPE=pg,
// PostgreSQL.
describe('Kysely incrementBucket', () => {
  let database: Database
  let db: Db

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    db = test.db
    await test.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const readRow = (id: string) =>
    db
      .selectFrom('counters')
      .select(['value', 'bucketHour', 'createdAt', 'updatedAt'])
      .where('id', '=', id)
      .executeTakeFirst()

  it('creates the bucket of the hour with its bucketHour', async () => {
    const at = new Date('2026-03-24T14:30:15.000Z')
    await incrementBucket(db, 'bucket-new', 2, at)

    expect(await readRow('bucket:bucket-new:2026032414')).toEqual({
      value: 2,
      bucketHour: Date.UTC(2026, 2, 24, 14),
      createdAt: at.getTime(),
      updatedAt: at.getTime()
    })
  })

  it('adds to the bucket of the same hour and moves only updatedAt', async () => {
    const first = new Date('2026-03-24T14:05:00.000Z')
    const second = new Date('2026-03-24T14:55:00.000Z')
    await incrementBucket(db, 'bucket-add', 3, first)
    await incrementBucket(db, 'bucket-add', 2, second)
    await incrementBucket(db, 'bucket-add', 1, new Date('2026-03-24T15:00:00Z'))

    expect(await readRow('bucket:bucket-add:2026032414')).toEqual({
      value: 5,
      bucketHour: Date.UTC(2026, 2, 24, 14),
      createdAt: first.getTime(),
      updatedAt: second.getTime()
    })
    expect((await readRow('bucket:bucket-add:2026032415'))?.value).toBe(1)
  })

  it('ignores an amount of zero or less', async () => {
    const at = new Date('2026-03-24T14:30:00.000Z')
    await incrementBucket(db, 'bucket-none', 0, at)
    await incrementBucket(db, 'bucket-none', -1, at)

    expect(await readRow('bucket:bucket-none:2026032414')).toBeUndefined()
  })

  it('sets bucketHour once on a row the generic counter helpers created', async () => {
    const created = new Date('2026-03-24T14:10:00.000Z')
    const bumped = new Date('2026-03-24T14:40:00.000Z')
    // Neighbours that must not pick up the bucketHour: another bucket without
    // one, and a row whose bucketHour is already set to something else.
    await increaseCounterValue(db, 'bucket:bucket-fill:2026032414', 4, created)
    await increaseCounterValue(db, 'bucket:bucket-other:2026032414', 1, created)
    await increaseCounterValue(db, 'bucket:bucket-set:2026032414', 1, created)
    await db
      .updateTable('counters')
      .set({ bucketHour: new Date('2020-01-01T00:00:00.000Z') })
      .where('id', '=', 'bucket:bucket-set:2026032414')
      .execute()

    await incrementBucket(db, 'bucket-fill', 1, bumped)
    await incrementBucket(db, 'bucket-set', 1, bumped)

    expect(await readRow('bucket:bucket-fill:2026032414')).toEqual({
      value: 5,
      bucketHour: Date.UTC(2026, 2, 24, 14),
      createdAt: created.getTime(),
      updatedAt: bumped.getTime()
    })
    expect((await readRow('bucket:bucket-other:2026032414'))?.bucketHour).toBe(
      null
    )
    expect((await readRow('bucket:bucket-set:2026032414'))?.bucketHour).toBe(
      Date.UTC(2020, 0, 1)
    )
  })

  it('keeps a bucket per counter type', async () => {
    const at = new Date('2026-03-24T14:30:00.000Z')
    await incrementBucket(db, 'bucket-type-a', 1, at)
    await incrementBucket(db, 'bucket-type-b', 2, at)

    expect((await readRow('bucket:bucket-type-a:2026032414'))?.value).toBe(1)
    expect((await readRow('bucket:bucket-type-b:2026032414'))?.value).toBe(2)
  })

  describe('getBucketStats', () => {
    const hour = (day: number, hourOfDay: number) =>
      new Date(Date.UTC(2026, 4, day, hourOfDay))

    it('reads the buckets of the type within the range, oldest hour first', async () => {
      // Recorded out of order: the result is ordered by hour, not by insertion.
      await incrementBucket(db, 'stats-order', 4, hour(10, 14))
      await incrementBucket(db, 'stats-order', 2, hour(10, 12))
      await incrementBucket(db, 'stats-order', 3, hour(10, 13))

      expect(
        await getBucketStats(db, 'stats-order', hour(10, 0), hour(10, 23))
      ).toEqual([
        { bucketHour: hour(10, 12).getTime(), value: 2 },
        { bucketHour: hour(10, 13).getTime(), value: 3 },
        { bucketHour: hour(10, 14).getTime(), value: 4 }
      ])
    })

    it('orders by the hour even when the ids sort the other way', async () => {
      for (const [suffix, at, value] of [
        ['a', hour(18, 14), 4],
        ['b', hour(18, 13), 3],
        ['c', hour(18, 12), 2]
      ] as const) {
        await db
          .insertInto('counters')
          .values({
            id: `bucket:stats-sort:${suffix}`,
            value,
            bucketHour: at,
            createdAt: at,
            updatedAt: at
          })
          .execute()
      }

      expect(
        await getBucketStats(db, 'stats-sort', hour(18, 0), hour(18, 23))
      ).toEqual([
        { bucketHour: hour(18, 12).getTime(), value: 2 },
        { bucketHour: hour(18, 13).getTime(), value: 3 },
        { bucketHour: hour(18, 14).getTime(), value: 4 }
      ])
    })

    it('includes the first and last hour of the range and nothing outside it', async () => {
      for (const at of [
        hour(11, 9),
        hour(11, 10),
        hour(11, 11),
        hour(11, 12),
        hour(11, 13)
      ]) {
        await incrementBucket(db, 'stats-range', at.getUTCHours(), at)
      }

      const stats = await getBucketStats(
        db,
        'stats-range',
        hour(11, 10),
        hour(11, 12)
      )
      expect(stats.map((stat) => stat.value)).toEqual([10, 11, 12])
    })

    it('compares the range as instants, not as whole hours', async () => {
      await incrementBucket(db, 'stats-instant', 1, hour(12, 10))
      await incrementBucket(db, 'stats-instant', 2, hour(12, 11))

      const justAfterStart = new Date(hour(12, 10).getTime() + 1)
      const justBeforeEnd = new Date(hour(12, 11).getTime() - 1)
      expect(
        await getBucketStats(db, 'stats-instant', justAfterStart, hour(12, 11))
      ).toEqual([{ bucketHour: hour(12, 11).getTime(), value: 2 }])
      expect(
        await getBucketStats(db, 'stats-instant', hour(12, 10), justBeforeEnd)
      ).toEqual([{ bucketHour: hour(12, 10).getTime(), value: 1 }])
    })

    it('reads only the buckets of the requested counter type', async () => {
      const at = hour(13, 8)
      await incrementBucket(db, 'stats-type', 5, at)
      await incrementBucket(db, 'stats-type-other', 6, at)
      await incrementBucket(db, 'other-stats-type', 7, at)
      // An id that only contains the prefix, with a bucketHour in range.
      await db
        .insertInto('counters')
        .values({
          id: 'x-bucket:stats-type:2026051308',
          value: 8,
          bucketHour: at,
          createdAt: at,
          updatedAt: at
        })
        .execute()

      expect(
        await getBucketStats(db, 'stats-type', hour(13, 0), hour(13, 23))
      ).toEqual([{ bucketHour: at.getTime(), value: 5 }])
    })

    it('skips a counter that has the bucket id but no bucketHour', async () => {
      const at = hour(14, 8)
      await incrementBucket(db, 'stats-null', 3, at)
      await increaseCounterValue(db, 'bucket:stats-null:2026051409', 40, at)

      expect(
        await getBucketStats(db, 'stats-null', hour(14, 0), hour(14, 23))
      ).toEqual([{ bucketHour: at.getTime(), value: 3 }])
    })

    it('reads nothing when no bucket lies in the range', async () => {
      await incrementBucket(db, 'stats-empty', 1, hour(15, 8))

      expect(
        await getBucketStats(db, 'stats-empty', hour(16, 0), hour(16, 23))
      ).toEqual([])
      // An end before the start matches nothing.
      expect(
        await getBucketStats(db, 'stats-empty', hour(15, 23), hour(15, 0))
      ).toEqual([])
    })
  })
})
