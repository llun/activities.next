import knex, { Knex } from 'knex'

import {
  getInstanceActivity as getInstanceActivityFromCounters,
  recordWeeklyLoginSafely
} from '@/lib/database/domains/instanceActivity/queries'
import { type Db, kyselyFor } from '@/lib/database/kysely'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { logger } from '@/lib/utils/logger'

const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000)

describe('instance activity counters', () => {
  let database: Knex
  let db: Db

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    db = kyselyFor(database)

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

  it('groups SQLite timestamp strings without timezone as UTC', async () => {
    await withTimeZone('Europe/Amsterdam', async () => {
      await database('counters').insert({
        id: 'bucket:local-statuses:2026052500',
        value: 1,
        bucketHour: '2026-05-25 00:30:00.000',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })

      const activity = await getInstanceActivityFromCounters(db, {
        now: new Date('2026-05-26T12:00:00.000Z')
      })

      expect(activity[0]).toMatchObject({
        week: String(toUnixSeconds(new Date('2026-05-25T00:00:00.000Z'))),
        statuses: '1'
      })
      expect(activity[1]).toMatchObject({
        week: String(toUnixSeconds(new Date('2026-05-18T00:00:00.000Z'))),
        statuses: '0'
      })
    })
  })

  it('filters bucket rows by sortable counter id range in the database query', async () => {
    const queries: { sql: string; bindings?: unknown[] }[] = []
    const onQuery = (query: { sql: string; bindings?: unknown[] }) =>
      queries.push(query)
    database.on('query', onQuery)

    try {
      await getInstanceActivityFromCounters(db, {
        now: new Date('2026-05-26T12:00:00.000Z')
      })
    } finally {
      database.off('query', onQuery)
    }

    const countersQuery = queries.find((query) =>
      query.sql.includes('from "counters"')
    )

    expect(countersQuery?.sql).toContain('"id" >= ?')
    expect(countersQuery?.sql).toContain('"id" < ?')
    expect(countersQuery?.sql).not.toContain('"bucketHour" >= ?')
    expect(countersQuery?.sql).not.toContain('"bucketHour" < ?')
    expect(countersQuery?.bindings).toEqual(
      expect.arrayContaining([
        'bucket:local-statuses:2026030900',
        'bucket:local-statuses:2026060100',
        'bucket:logins:2026030900',
        'bucket:logins:2026060100',
        'bucket:accounts:2026030900',
        'bucket:accounts:2026060100'
      ])
    )
  })

  it('logs weekly login recording failures with structured logger metadata', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined)

    try {
      await database.schema.dropTable('counters')
      await recordWeeklyLoginSafely(
        db,
        'account-log-error',
        new Date('2026-02-04T10:00:00.000Z')
      )

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ code: 'SQLITE_ERROR' }),
          accountId: 'account-log-error'
        }),
        'Failed to record weekly login'
      )
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })
})
