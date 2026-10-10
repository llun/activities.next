import type { Knex } from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import {
  adjustCounterValue,
  decreaseCounterValue,
  getCounterValue,
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import {
  getCounterValues as getKnexCounterValues,
  increaseCounterValue as increaseKnexCounterValue
} from '@/lib/database/sql/utils/counter'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// Same contract as the Knex helpers in lib/database/sql/utils/counter.ts,
// checked on SQLite and, under TEST_DATABASE_TYPE=pg, PostgreSQL.
describe('Kysely counter helpers', () => {
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
      .select(['value', 'createdAt', 'updatedAt'])
      .where('id', '=', id)
      .executeTakeFirst()

  it('compares a timestamp column through timestampValue() on both backends', async () => {
    const at = new Date('2026-03-05T12:00:00.000Z')
    await increaseCounterValue(kyselyFor(instance), 'counter-compare', 1, at)
    const matching = async (operand: ReturnType<typeof timestampValue>) =>
      (
        await kyselyFor(instance)
          .selectFrom('counters')
          .select('id')
          .where('id', '=', 'counter-compare')
          .where('createdAt', '<', operand)
          .execute()
      ).length
    const before = at.getTime() - 1
    const after = at.getTime() + 1
    expect(await matching(timestampValue(after))).toBe(1)
    expect(await matching(timestampValue(new Date(after)))).toBe(1)
    expect(await matching(timestampValue(before))).toBe(0)
    expect(await matching(timestampValue(new Date(before)))).toBe(0)
  })

  it('creates a missing counter at the increment', async () => {
    const at = new Date('2026-03-01T00:00:00.000Z')
    await increaseCounterValue(kyselyFor(instance), 'counter-new', 3, at)
    expect(await readRow('counter-new')).toEqual({
      value: 3,
      createdAt: at.getTime(),
      updatedAt: at.getTime()
    })
  })

  it('adds to an existing counter and moves only updatedAt', async () => {
    const created = new Date('2026-03-01T00:00:00.000Z')
    const updated = new Date('2026-03-02T00:00:00.000Z')
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-add', 1, created)
    await increaseCounterValue(db, 'counter-add', 2, updated)
    expect(await readRow('counter-add')).toEqual({
      value: 3,
      createdAt: created.getTime(),
      updatedAt: updated.getTime()
    })
  })

  it('clamps at zero, including for a missing counter', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-clamp', 2)
    await decreaseCounterValue(db, 'counter-clamp', 5)
    await decreaseCounterValue(db, 'counter-missing', 1)
    expect(await getCounterValue(db, 'counter-clamp')).toBe(0)
    expect((await readRow('counter-missing'))?.value).toBe(0)
  })

  it('clamps at Number.MAX_SAFE_INTEGER', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-max', Number.MAX_SAFE_INTEGER - 1)
    await increaseCounterValue(db, 'counter-max', 5)
    expect(await getCounterValue(db, 'counter-max')).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('treats a zero adjustment as a no-op', async () => {
    await adjustCounterValue(kyselyFor(instance), 'counter-zero', 0)
    expect(await readRow('counter-zero')).toBeUndefined()
  })

  it('applies concurrent adjustments without losing any', async () => {
    const db = kyselyFor(instance)
    await Promise.all(
      Array.from({ length: 20 }, () =>
        increaseCounterValue(db, 'counter-concurrent')
      )
    )
    expect(await getCounterValue(db, 'counter-concurrent')).toBe(20)
  })

  it('shares a counter row with the Knex helpers', async () => {
    const db = kyselyFor(instance)
    await increaseKnexCounterValue(instance, 'counter-interop', 2)
    await increaseCounterValue(db, 'counter-interop', 3)
    await increaseKnexCounterValue(instance, 'counter-interop', 4)
    await decreaseCounterValue(db, 'counter-interop', 1)
    expect(await getCounterValue(db, 'counter-interop')).toBe(8)
    const row = await instance('counters')
      .where('id', 'counter-interop')
      .first('value')
    expect(Number(row?.value)).toBe(8)
  })

  it('reads the values of the requested counters only', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counters-a', 2)
    await increaseCounterValue(db, 'counters-b', 5)
    // Neighbours that must not come back: another id, and ids that merely
    // start or end like a requested one.
    await increaseCounterValue(db, 'counters-c', 9)
    await increaseCounterValue(db, 'counters-a-suffix', 11)
    await increaseCounterValue(db, 'x-counters-b', 13)

    expect(await getCounterValues(db, ['counters-a', 'counters-b'])).toEqual({
      'counters-a': 2,
      'counters-b': 5
    })
  })

  it('leaves a missing counter out of the values', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counters-present', 4)

    expect(
      await getCounterValues(db, ['counters-present', 'counters-missing'])
    ).toEqual({ 'counters-present': 4 })
    expect(await getCounterValues(db, ['counters-missing'])).toEqual({})
  })

  it('reads no values for an empty list', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counters-unlisted', 1)

    expect(await getCounterValues(db, [])).toEqual({})
  })

  it('reads the same values as the Knex helper', async () => {
    const db = kyselyFor(instance)
    const ids = ['counters-same-a', 'counters-same-b', 'counters-same-none']
    await increaseKnexCounterValue(instance, ids[0], 3)
    await increaseCounterValue(db, ids[1], 8)

    const values = await getCounterValues(db, ids)
    expect(values).toEqual({ [ids[0]]: 3, [ids[1]]: 8 })
    expect(await getKnexCounterValues(instance, ids)).toEqual(values)
  })

  it('reads 0 for a missing counter', async () => {
    expect(await getCounterValue(kyselyFor(instance), 'counter-none')).toBe(0)
  })
})
