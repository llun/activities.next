import type { Knex } from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import {
  adjustCounterValue,
  decreaseCounterValue,
  deleteCounterValue,
  deleteCounterValues,
  getCounterValue,
  getCounterValues,
  increaseCounterValue,
  setCounterValue
} from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// The `counters` helpers, on SQLite and, under TEST_DATABASE_TYPE=pg,
// PostgreSQL.
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

  it('adds the size of an amount, whatever its sign', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-sign', -2)
    await decreaseCounterValue(db, 'counter-sign', -1)
    expect(await getCounterValue(db, 'counter-sign')).toBe(1)
  })

  it('writes no row for an increase or decrease of zero', async () => {
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-zero-increase', 0)
    await decreaseCounterValue(db, 'counter-zero-decrease', 0)
    expect(await readRow('counter-zero-increase')).toBeUndefined()
    expect(await readRow('counter-zero-decrease')).toBeUndefined()
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

  it('sets a missing counter, then overwrites it and moves only updatedAt', async () => {
    const created = new Date('2026-04-01T00:00:00.000Z')
    const updated = new Date('2026-04-02T00:00:00.000Z')
    const db = kyselyFor(instance)
    await increaseCounterValue(db, 'counter-set-neighbour', 7)
    await setCounterValue(db, 'counter-set', 12, created)
    expect(await readRow('counter-set')).toEqual({
      value: 12,
      createdAt: created.getTime(),
      updatedAt: created.getTime()
    })
    await setCounterValue(db, 'counter-set', 4, updated)
    expect(await readRow('counter-set')).toEqual({
      value: 4,
      createdAt: created.getTime(),
      updatedAt: updated.getTime()
    })
    expect(await getCounterValue(db, 'counter-set-neighbour')).toBe(7)
  })

  it.each([
    { value: -5, stored: 0 },
    { value: 0, stored: 0 },
    { value: 0.5, stored: 0 },
    { value: 7.9, stored: 7 },
    { value: Number.MAX_SAFE_INTEGER, stored: Number.MAX_SAFE_INTEGER },
    { value: Number.MAX_SAFE_INTEGER * 4, stored: Number.MAX_SAFE_INTEGER },
    { value: Number.NaN, stored: 0 },
    { value: Number.POSITIVE_INFINITY, stored: 0 }
  ])(
    'sets $value as $stored, clamped and truncated',
    async ({ value, stored }) => {
      const db = kyselyFor(instance)
      await setCounterValue(db, `counter-set-${value}`, value)
      expect(await getCounterValue(db, `counter-set-${value}`)).toBe(stored)
    }
  )

  it('deletes one counter, and the listed counters in chunks', async () => {
    const db = kyselyFor(instance)
    const listed = Array.from({ length: 1001 }, (_, i) => `counter-del-${i}`)
    for (const id of ['counter-del-one', 'counter-del-kept', ...listed]) {
      await setCounterValue(db, id, 1)
    }

    await deleteCounterValue(db, 'counter-del-one')
    await deleteCounterValue(db, 'counter-del-missing')
    // More ids than one statement takes on either backend.
    await deleteCounterValues(db, listed)
    await deleteCounterValues(db, [])

    expect(await readRow('counter-del-one')).toBeUndefined()
    expect(await getCounterValues(db, listed.slice(0, 900))).toEqual({})
    expect(await getCounterValues(db, listed.slice(900))).toEqual({})
    expect(await getCounterValue(db, 'counter-del-kept')).toBe(1)
  })

  it('reads 0 for a missing counter', async () => {
    expect(await getCounterValue(kyselyFor(instance), 'counter-none')).toBe(0)
  })
})
