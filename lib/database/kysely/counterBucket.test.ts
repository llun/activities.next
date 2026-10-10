import type { Knex } from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import { incrementBucket as incrementKnexBucket } from '@/lib/database/sql/utils/counterBucket'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// Same contract as the Knex helper in lib/database/sql/utils/counterBucket.ts,
// checked on SQLite and, under TEST_DATABASE_TYPE=pg, PostgreSQL.
describe('Kysely incrementBucket', () => {
  let database: Database
  let instance: Knex

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    instance = test.instance
    await test.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const readRow = (id: string) =>
    kyselyFor(instance)
      .selectFrom('counters')
      .select(['value', 'bucketHour', 'createdAt', 'updatedAt'])
      .where('id', '=', id)
      .executeTakeFirst()

  it('creates the bucket of the hour with its bucketHour', async () => {
    const at = new Date('2026-03-24T14:30:15.000Z')
    await incrementBucket(kyselyFor(instance), 'bucket-new', 2, at)

    expect(await readRow('bucket:bucket-new:2026032414')).toEqual({
      value: 2,
      bucketHour: Date.UTC(2026, 2, 24, 14),
      createdAt: at.getTime(),
      updatedAt: at.getTime()
    })
  })

  it('adds to the bucket of the same hour and moves only updatedAt', async () => {
    const db = kyselyFor(instance)
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
    const db = kyselyFor(instance)
    const at = new Date('2026-03-24T14:30:00.000Z')
    await incrementBucket(db, 'bucket-none', 0, at)
    await incrementBucket(db, 'bucket-none', -1, at)

    expect(await readRow('bucket:bucket-none:2026032414')).toBeUndefined()
  })

  it('sets bucketHour once on a row the generic counter helpers created', async () => {
    const db = kyselyFor(instance)
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

  it('shares its bucket rows with the Knex helper', async () => {
    const db = kyselyFor(instance)
    const at = new Date('2026-03-24T14:30:00.000Z')
    await incrementKnexBucket(instance, 'bucket-interop', 2, at)
    await incrementBucket(db, 'bucket-interop', 3, at)
    await incrementKnexBucket(instance, 'bucket-interop', 4, at)

    expect((await readRow('bucket:bucket-interop:2026032414'))?.value).toBe(9)
  })
})
