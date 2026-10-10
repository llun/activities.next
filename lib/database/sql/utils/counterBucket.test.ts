import knex, { Knex } from 'knex'

import {
  formatBucketHour,
  incrementBucket,
  truncateToHour
} from './counterBucket'

describe('counterBucket utils', () => {
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
      table.timestamp('bucketHour').nullable().defaultTo(null)
      table.timestamp('createdAt').notNullable()
      table.timestamp('updatedAt').notNullable()
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('formatBucketHour', () => {
    it.each([
      {
        description: 'formats a date to compact UTC hour string',
        input: '2026-03-24T14:30:00Z',
        expected: '2026032414'
      },
      {
        description: 'pads single-digit months, days, and hours',
        input: '2026-01-05T03:00:00Z',
        expected: '2026010503'
      },
      {
        description: 'handles midnight correctly',
        input: '2026-12-31T00:00:00Z',
        expected: '2026123100'
      },
      {
        description: 'handles end of day correctly',
        input: '2026-06-15T23:59:59Z',
        expected: '2026061523'
      }
    ])('$description', ({ input, expected }) => {
      expect(formatBucketHour(new Date(input))).toBe(expected)
    })
  })

  describe('truncateToHour', () => {
    it('truncates minutes, seconds, and milliseconds', () => {
      const date = new Date('2026-03-24T14:45:30.123Z')
      const result = truncateToHour(date)
      expect(result.toISOString()).toBe('2026-03-24T14:00:00.000Z')
    })

    it('returns same value for already-truncated dates', () => {
      const date = new Date('2026-03-24T14:00:00.000Z')
      const result = truncateToHour(date)
      expect(result.toISOString()).toBe('2026-03-24T14:00:00.000Z')
    })

    it('uses UTC, not local time', () => {
      const date = new Date('2026-03-24T00:30:00.000Z')
      const result = truncateToHour(date)
      expect(result.getUTCHours()).toBe(0)
      expect(result.getUTCMinutes()).toBe(0)
    })
  })

  describe('incrementBucket', () => {
    it('creates a new bucket counter with correct id and bucketHour', async () => {
      const time = new Date('2026-03-24T14:30:00Z')
      await incrementBucket(database, 'accounts', 1, time)

      const row = await database('counters')
        .where('id', 'bucket:accounts:2026032414')
        .first()
      expect(row).toBeDefined()
      expect(Number(row.value)).toBe(1)
      expect(row.bucketHour).toBeDefined()
    })

    it('increments an existing bucket counter', async () => {
      const time = new Date('2026-03-24T14:30:00Z')
      await incrementBucket(database, 'accounts', 3, time)
      await incrementBucket(database, 'accounts', 2, time)

      const value = Number(
        (
          await database('counters')
            .where('id', 'bucket:accounts:2026032414')
            .first()
        ).value
      )
      expect(value).toBe(5)
    })

    it('does nothing when amount is 0 or negative', async () => {
      const time = new Date('2026-03-24T14:30:00Z')
      await incrementBucket(database, 'accounts', 0, time)
      await incrementBucket(database, 'accounts', -1, time)

      const rows = await database('counters').select('id')
      expect(rows).toHaveLength(0)
    })

    it('creates separate buckets for different hours', async () => {
      const time1 = new Date('2026-03-24T14:30:00Z')
      const time2 = new Date('2026-03-24T15:30:00Z')
      await incrementBucket(database, 'accounts', 1, time1)
      await incrementBucket(database, 'accounts', 1, time2)

      const rows = await database('counters').select('id')
      expect(rows).toHaveLength(2)
    })

    it('creates separate buckets for different counter types', async () => {
      const time = new Date('2026-03-24T14:30:00Z')
      await incrementBucket(database, 'accounts', 1, time)
      await incrementBucket(database, 'statuses', 1, time)

      const rows = await database('counters').select('id')
      expect(rows).toHaveLength(2)
    })
  })
})
