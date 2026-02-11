import knex, { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValue,
  getCounterValue,
  getCounterValues,
  increaseCounterValue,
  parseCounterValue,
  setCounterValue
} from './counter'

describe('counter utils', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    await database.schema.createTable('counters', function (table) {
      table.text('id').primary()
      table.bigInteger('value').notNullable().defaultTo(0)
      table.timestamp('createdAt').notNullable()
      table.timestamp('updatedAt').notNullable()
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('parseCounterValue', () => {
    it('returns 0 for nullish and invalid values', () => {
      expect(parseCounterValue(undefined)).toBe(0)
      expect(parseCounterValue(null)).toBe(0)
      expect(parseCounterValue('not-a-number')).toBe(0)
      expect(parseCounterValue(Number.NaN)).toBe(0)
      expect(parseCounterValue(Number.POSITIVE_INFINITY)).toBe(0)
    })

    it('clamps to non-negative integer values', () => {
      expect(parseCounterValue(-1)).toBe(0)
      expect(parseCounterValue(0)).toBe(0)
      expect(parseCounterValue(3.9)).toBe(3)
      expect(parseCounterValue('12')).toBe(12)
      expect(parseCounterValue(9n)).toBe(9)
    })

    it('clamps values above Number.MAX_SAFE_INTEGER', () => {
      expect(parseCounterValue('9007199254740993')).toBe(
        Number.MAX_SAFE_INTEGER
      )
      expect(parseCounterValue(BigInt(Number.MAX_SAFE_INTEGER) + 10n)).toBe(
        Number.MAX_SAFE_INTEGER
      )
    })
  })

  describe('CounterKey', () => {
    it('builds expected key namespaces', () => {
      expect(CounterKey.totalStatus('actor')).toBe('total-status:actor')
      expect(CounterKey.totalFollowers('actor')).toBe('total-followers:actor')
      expect(CounterKey.totalFollowing('actor')).toBe('total-following:actor')
      expect(CounterKey.totalLike('status')).toBe('total-like:status')
      expect(CounterKey.totalReblog('status')).toBe('total-reblog:status')
      expect(CounterKey.totalReply('status')).toBe('total-reply:status')
      expect(CounterKey.mediaUsage('account')).toBe('media-usage:account')
      expect(CounterKey.totalMedia('account')).toBe('total-media:account')
      expect(CounterKey.fitnessUsage('account')).toBe('fitness-usage:account')
      expect(CounterKey.totalFitness('account')).toBe('total-fitness:account')
    })
  })

  it('returns 0 for missing counters', async () => {
    const value = await getCounterValue(database, 'missing')
    expect(value).toBe(0)
  })

  it('sets and updates counter values with upsert behavior', async () => {
    await setCounterValue(database, 'counter-a', 5)
    expect(await getCounterValue(database, 'counter-a')).toBe(5)

    await setCounterValue(database, 'counter-a', 8)
    expect(await getCounterValue(database, 'counter-a')).toBe(8)
  })

  it('returns only existing counters from batch fetch', async () => {
    await setCounterValue(database, 'counter-a', 3)
    await setCounterValue(database, 'counter-b', 7)

    const values = await getCounterValues(database, [
      'counter-a',
      'missing',
      'counter-b'
    ])

    expect(values).toEqual({
      'counter-a': 3,
      'counter-b': 7
    })
  })

  it('increases counters from missing values', async () => {
    await increaseCounterValue(database, 'counter-a', 2)
    expect(await getCounterValue(database, 'counter-a')).toBe(2)
  })

  it('decreases counters and clamps at zero', async () => {
    await setCounterValue(database, 'counter-a', 1)
    await decreaseCounterValue(database, 'counter-a', 3)
    expect(await getCounterValue(database, 'counter-a')).toBe(0)
  })

  it('normalizes amount signs for increase/decrease', async () => {
    await increaseCounterValue(database, 'counter-a', -2)
    await decreaseCounterValue(database, 'counter-a', -1)
    expect(await getCounterValue(database, 'counter-a')).toBe(1)
  })

  it('does not create rows when delta is zero', async () => {
    await increaseCounterValue(database, 'counter-a', 0)
    await decreaseCounterValue(database, 'counter-b', 0)

    const rows = await database('counters').select('id')
    expect(rows).toHaveLength(0)
  })

  it('handles concurrent increments without losing updates', async () => {
    await Promise.all(
      Array.from({ length: 50 }).map(() =>
        increaseCounterValue(database, 'counter-a', 1)
      )
    )

    expect(await getCounterValue(database, 'counter-a')).toBe(50)
  })

  it('deletes a counter value', async () => {
    await setCounterValue(database, 'counter-a', 4)
    await deleteCounterValue(database, 'counter-a')

    expect(await getCounterValue(database, 'counter-a')).toBe(0)
  })
})
