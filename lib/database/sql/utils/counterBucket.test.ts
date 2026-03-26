import knex, { Knex } from 'knex'

import {
  BucketStatRow,
  formatBucketHour,
  getBucketStats,
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
    it('formats a date to compact UTC hour string', () => {
      const date = new Date('2026-03-24T14:30:00Z')
      expect(formatBucketHour(date)).toBe('2026032414')
    })

    it('pads single-digit months, days, and hours', () => {
      const date = new Date('2026-01-05T03:00:00Z')
      expect(formatBucketHour(date)).toBe('2026010503')
    })

    it('handles midnight correctly', () => {
      const date = new Date('2026-12-31T00:00:00Z')
      expect(formatBucketHour(date)).toBe('2026123100')
    })

    it('handles end of day correctly', () => {
      const date = new Date('2026-06-15T23:59:59Z')
      expect(formatBucketHour(date)).toBe('2026061523')
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

  describe('getBucketStats', () => {
    it('returns empty array when no buckets exist', async () => {
      const start = new Date('2026-03-24T00:00:00Z')
      const end = new Date('2026-03-24T23:59:59Z')
      const result = await getBucketStats(database, 'accounts', start, end)
      expect(result).toEqual([])
    })

    it('returns buckets within the date range sorted by bucketHour', async () => {
      const times = [
        new Date('2026-03-24T10:00:00Z'),
        new Date('2026-03-24T12:00:00Z'),
        new Date('2026-03-24T14:00:00Z')
      ]
      for (const t of times) {
        await incrementBucket(database, 'accounts', 1, t)
      }

      const start = new Date('2026-03-24T00:00:00Z')
      const end = new Date('2026-03-24T23:59:59Z')
      const result = await getBucketStats(database, 'accounts', start, end)

      expect(result).toHaveLength(3)
      expect(result[0].value).toBe(1)
      expect(result[1].value).toBe(1)
      expect(result[2].value).toBe(1)
      // Verify sorting
      expect(result[0].bucketHour.getTime()).toBeLessThan(
        result[1].bucketHour.getTime()
      )
      expect(result[1].bucketHour.getTime()).toBeLessThan(
        result[2].bucketHour.getTime()
      )
    })

    it('excludes buckets outside the date range', async () => {
      await incrementBucket(
        database,
        'accounts',
        1,
        new Date('2026-03-23T10:00:00Z')
      )
      await incrementBucket(
        database,
        'accounts',
        1,
        new Date('2026-03-24T10:00:00Z')
      )
      await incrementBucket(
        database,
        'accounts',
        1,
        new Date('2026-03-25T10:00:00Z')
      )

      const start = new Date('2026-03-24T00:00:00Z')
      const end = new Date('2026-03-24T23:59:59Z')
      const result = await getBucketStats(database, 'accounts', start, end)

      expect(result).toHaveLength(1)
    })

    it('filters by counter type', async () => {
      const time = new Date('2026-03-24T10:00:00Z')
      await incrementBucket(database, 'accounts', 5, time)
      await incrementBucket(database, 'statuses', 3, time)

      const start = new Date('2026-03-24T00:00:00Z')
      const end = new Date('2026-03-24T23:59:59Z')

      const accountResult = await getBucketStats(
        database,
        'accounts',
        start,
        end
      )
      const statusResult = await getBucketStats(
        database,
        'statuses',
        start,
        end
      )

      expect(accountResult).toHaveLength(1)
      expect(accountResult[0].value).toBe(5)
      expect(statusResult).toHaveLength(1)
      expect(statusResult[0].value).toBe(3)
    })

    it('returns proper Date objects for bucketHour', async () => {
      await incrementBucket(
        database,
        'accounts',
        1,
        new Date('2026-03-24T14:30:00Z')
      )

      const start = new Date('2026-03-24T00:00:00Z')
      const end = new Date('2026-03-24T23:59:59Z')
      const result: BucketStatRow[] = await getBucketStats(
        database,
        'accounts',
        start,
        end
      )

      expect(result[0].bucketHour).toBeInstanceOf(Date)
      expect(result[0].bucketHour.toISOString()).toBe(
        '2026-03-24T14:00:00.000Z'
      )
    })
  })
})
