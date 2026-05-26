import knex, { Knex } from 'knex'

import { getInstanceActivityFromCounters } from '@/lib/database/sql/instanceActivity'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000)

describe('instance activity counters', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('counters', (table) => {
      table.string('id').primary()
      table.integer('value').defaultTo(0)
      table.timestamp('bucketHour', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  const insertBucket = async ({
    type,
    hour,
    value
  }: {
    type: string
    hour: Date
    value: number
  }) => {
    const y = hour.getUTCFullYear()
    const mo = String(hour.getUTCMonth() + 1).padStart(2, '0')
    const d = String(hour.getUTCDate()).padStart(2, '0')
    const h = String(hour.getUTCHours()).padStart(2, '0')
    const hourKey = `${y}${mo}${d}${h}`

    await database('counters').insert({
      id: `bucket:${type}:${hourKey}`,
      value,
      bucketHour: hour,
      createdAt: hour,
      updatedAt: hour
    })
  }

  it('returns 12 newest-first UTC weeks using only counter buckets', async () => {
    const now = new Date('2026-05-26T12:00:00.000Z')
    const newestWeekStart = new Date('2026-05-25T00:00:00.000Z')
    const previousWeekStart = new Date(newestWeekStart.getTime() - WEEK_MS)
    const twoWeeksAgoStart = new Date(newestWeekStart.getTime() - 2 * WEEK_MS)

    await insertBucket({
      type: 'local-statuses',
      hour: new Date('2026-05-25T01:00:00.000Z'),
      value: 3
    })
    await insertBucket({
      type: 'accounts',
      hour: new Date('2026-05-19T08:00:00.000Z'),
      value: 2
    })
    await insertBucket({
      type: 'logins',
      hour: new Date('2026-05-11T12:00:00.000Z'),
      value: 4
    })
    await insertBucket({
      type: 'statuses',
      hour: new Date('2026-05-25T02:00:00.000Z'),
      value: 999
    })

    const activity = await getInstanceActivityFromCounters(database, { now })

    expect(activity).toHaveLength(12)
    expect(activity.slice(0, 3)).toEqual([
      {
        week: String(toUnixSeconds(newestWeekStart)),
        statuses: '3',
        logins: '0',
        registrations: '0'
      },
      {
        week: String(toUnixSeconds(previousWeekStart)),
        statuses: '0',
        logins: '0',
        registrations: '2'
      },
      {
        week: String(toUnixSeconds(twoWeeksAgoStart)),
        statuses: '0',
        logins: '4',
        registrations: '0'
      }
    ])
    expect(activity[11]).toEqual({
      week: String(
        toUnixSeconds(new Date(newestWeekStart.getTime() - 11 * WEEK_MS))
      ),
      statuses: '0',
      logins: '0',
      registrations: '0'
    })
  })
})
