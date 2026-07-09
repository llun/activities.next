import knex, { Knex } from 'knex'

import {
  getInstanceActivityFromCounters,
  getInstanceAdminActorIdFromAccounts,
  recordWeeklyLogin,
  recordWeeklyLoginSafely
} from '@/lib/database/sql/instanceActivity'
import { logger } from '@/lib/utils/logger'

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

  it('groups SQLite timestamp strings without timezone as UTC', async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = 'Europe/Amsterdam'

    try {
      await database('counters').insert({
        id: 'bucket:local-statuses:2026052500',
        value: 1,
        bucketHour: '2026-05-25 00:30:00.000',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })

      const activity = await getInstanceActivityFromCounters(database, {
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
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTimeZone
      }
    }
  })

  it('filters bucket rows by sortable counter id range in the database query', async () => {
    const queries: { sql: string; bindings?: unknown[] }[] = []
    const onQuery = (query: { sql: string; bindings?: unknown[] }) =>
      queries.push(query)
    database.on('query', onQuery)

    try {
      await getInstanceActivityFromCounters(database, {
        now: new Date('2026-05-26T12:00:00.000Z')
      })
    } finally {
      database.off('query', onQuery)
    }

    const countersQuery = queries.find((query) =>
      query.sql.includes('from `counters`')
    )

    expect(countersQuery?.sql).toContain('`id` >= ?')
    expect(countersQuery?.sql).toContain('`id` < ?')
    expect(countersQuery?.sql).not.toContain('`bucketHour` >= ?')
    expect(countersQuery?.sql).not.toContain('`bucketHour` < ?')
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

  it('stores one weekly login marker per account', async () => {
    await recordWeeklyLogin(
      database,
      'account-login',
      new Date('2026-01-08T10:00:00.000Z')
    )
    await recordWeeklyLogin(
      database,
      'account-login',
      new Date('2026-01-09T10:00:00.000Z')
    )
    await recordWeeklyLogin(
      database,
      'account-login',
      new Date('2026-01-13T10:00:00.000Z')
    )

    const markerRows = await database('counters')
      .where('id', 'like', 'unique-login:%')
      .select('id', 'value')
    const loginRows = await database('counters')
      .where('id', 'like', 'bucket:logins:%')
      .select('value')

    expect(markerRows).toEqual([
      {
        id: 'unique-login:account-login',
        value: Math.floor(Date.UTC(2026, 0, 12) / 1000)
      }
    ])
    expect(loginRows.reduce((total, row) => total + Number(row.value), 0)).toBe(
      2
    )
  })

  it('leaves weekly login markers retryable when bucket increments fail', async () => {
    const currentTime = new Date('2026-02-04T10:00:00.000Z')

    await database.raw(`
      CREATE TRIGGER fail_login_bucket_update
      BEFORE UPDATE OF value ON counters
      WHEN NEW.id LIKE 'bucket:logins:%'
      BEGIN
        SELECT RAISE(ABORT, 'bucket failure');
      END;
    `)

    try {
      await recordWeeklyLogin(database, 'account-retry', currentTime)
    } catch (error) {
      expect(String(error)).toContain('bucket failure')
    }

    await database.raw('DROP TRIGGER fail_login_bucket_update')
    await recordWeeklyLogin(database, 'account-retry', currentTime)

    const marker = await database('counters')
      .where('id', 'unique-login:account-retry')
      .first('id', 'value')
    const loginRows = await database('counters')
      .where('id', 'like', 'bucket:logins:%')
      .select('value')

    expect(marker).toEqual({
      id: 'unique-login:account-retry',
      value: Math.floor(Date.UTC(2026, 1, 2) / 1000)
    })
    expect(loginRows.reduce((total, row) => total + Number(row.value), 0)).toBe(
      1
    )
  })

  it('logs weekly login recording failures with structured logger metadata', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined)

    try {
      await database.schema.dropTable('counters')
      await recordWeeklyLoginSafely(
        database,
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

describe('getInstanceAdminActorIdFromAccounts', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('accounts', (table) => {
      table.string('id').primary()
      table.string('role').nullable()
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('accountId').nullable()
      table.string('deletionStatus').nullable()
      table.timestamp('createdAt', { useTz: true })
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('returns null when no account has the admin role', async () => {
    await database('accounts').insert({ id: 'account-1', role: null })
    await database('actors').insert({
      id: 'https://llun.test/users/user1',
      accountId: 'account-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    })

    await expect(
      getInstanceAdminActorIdFromAccounts(database)
    ).resolves.toBeNull()
  })

  it('returns the earliest-created actor owned by an admin account', async () => {
    await database('accounts').insert([
      { id: 'account-user', role: null },
      { id: 'account-admin', role: 'admin' }
    ])
    await database('actors').insert([
      {
        id: 'https://llun.test/users/user1',
        accountId: 'account-user',
        createdAt: new Date('2026-01-01T00:00:00.000Z')
      },
      {
        id: 'https://remote.test/users/remote',
        accountId: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z')
      },
      {
        id: 'https://llun.test/users/admin-alias',
        accountId: 'account-admin',
        createdAt: new Date('2026-03-01T00:00:00.000Z')
      },
      {
        id: 'https://llun.test/users/admin',
        accountId: 'account-admin',
        createdAt: new Date('2026-02-01T00:00:00.000Z')
      }
    ])

    await expect(getInstanceAdminActorIdFromAccounts(database)).resolves.toBe(
      'https://llun.test/users/admin'
    )
  })

  it('skips admin actors that are scheduled for deletion', async () => {
    await database('accounts').insert({ id: 'account-admin', role: 'admin' })
    await database('actors').insert([
      {
        id: 'https://llun.test/users/deleted-admin',
        accountId: 'account-admin',
        deletionStatus: 'scheduled',
        createdAt: new Date('2026-01-01T00:00:00.000Z')
      },
      {
        id: 'https://llun.test/users/admin',
        accountId: 'account-admin',
        createdAt: new Date('2026-02-01T00:00:00.000Z')
      }
    ])

    await expect(getInstanceAdminActorIdFromAccounts(database)).resolves.toBe(
      'https://llun.test/users/admin'
    )
  })
})
