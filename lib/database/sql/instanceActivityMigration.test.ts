import knex, { Knex } from 'knex'

import * as migration from '@/migrations/20260526112702_backfill_instance_activity_counters'

const sumCounterRows = (rows: { value: number | string | null }[]) =>
  rows.reduce((total, row) => total + Number(row.value ?? 0), 0)

describe('instance activity counter migration', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('accounts', (table) => {
      table.string('id').primary()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('accountId').nullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })
    await database.schema.createTable('sessions', (table) => {
      table.string('id').primary()
      table.string('accountId').notNullable()
      table.string('token').notNullable()
      table.timestamp('expireAt', { useTz: true })
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })
    await database.schema.createTable('counters', (table) => {
      table.string('id').primary()
      table.integer('value').defaultTo(0)
      table.timestamp('bucketHour', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })

    await database('accounts').insert([
      {
        id: 'account-a',
        createdAt: new Date('2026-05-19T08:00:00.000Z'),
        updatedAt: new Date('2026-05-19T08:00:00.000Z')
      },
      {
        id: 'account-b',
        createdAt: new Date('2026-05-21T08:00:00.000Z'),
        updatedAt: new Date('2026-05-21T08:00:00.000Z')
      }
    ])
    await database('actors').insert([
      {
        id: 'https://local.test/users/a',
        accountId: 'account-a',
        createdAt: new Date('2026-05-19T08:00:00.000Z'),
        updatedAt: new Date('2026-05-19T08:00:00.000Z')
      },
      {
        id: 'https://remote.test/users/r',
        accountId: null,
        createdAt: new Date('2026-05-19T08:00:00.000Z'),
        updatedAt: new Date('2026-05-19T08:00:00.000Z')
      }
    ])
    await database('statuses').insert([
      {
        id: 'local-status-a',
        actorId: 'https://local.test/users/a',
        createdAt: new Date('2026-05-19T10:00:00.000Z'),
        updatedAt: new Date('2026-05-19T10:00:00.000Z')
      },
      {
        id: 'local-status-b',
        actorId: 'https://local.test/users/a',
        createdAt: new Date('2026-05-20T11:00:00.000Z'),
        updatedAt: new Date('2026-05-20T11:00:00.000Z')
      },
      {
        id: 'remote-status',
        actorId: 'https://remote.test/users/r',
        createdAt: new Date('2026-05-20T12:00:00.000Z'),
        updatedAt: new Date('2026-05-20T12:00:00.000Z')
      }
    ])
    await database('sessions').insert([
      {
        id: 'session-a-week-one-first',
        accountId: 'account-a',
        token: 'token-a-1',
        expireAt: new Date('2026-06-19T09:00:00.000Z'),
        createdAt: new Date('2026-05-19T09:00:00.000Z'),
        updatedAt: new Date('2026-05-19T09:00:00.000Z')
      },
      {
        id: 'session-a-week-one-second',
        accountId: 'account-a',
        token: 'token-a-2',
        expireAt: new Date('2026-06-20T09:00:00.000Z'),
        createdAt: new Date('2026-05-20T09:00:00.000Z'),
        updatedAt: new Date('2026-05-20T09:00:00.000Z')
      },
      {
        id: 'session-b-week-one',
        accountId: 'account-b',
        token: 'token-b-1',
        expireAt: new Date('2026-06-21T09:00:00.000Z'),
        createdAt: new Date('2026-05-21T09:00:00.000Z'),
        updatedAt: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        id: 'session-a-week-two',
        accountId: 'account-a',
        token: 'token-a-3',
        expireAt: new Date('2026-06-26T09:00:00.000Z'),
        createdAt: new Date('2026-05-26T09:00:00.000Z'),
        updatedAt: new Date('2026-05-26T09:00:00.000Z')
      }
    ])
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('backfills local status buckets, weekly login buckets, and login markers', async () => {
    await migration.up(database)

    const localStatusRows = await database('counters')
      .where('id', 'like', 'bucket:local-statuses:%')
      .orderBy('id', 'asc')
      .select('id', 'value')
    const loginRows = await database('counters')
      .where('id', 'like', 'bucket:logins:%')
      .orderBy('id', 'asc')
      .select('id', 'value')
    const markerRows = await database('counters')
      .where('id', 'like', 'unique-login:%')
      .orderBy('id', 'asc')
      .select('id', 'value', 'bucketHour')

    expect(sumCounterRows(localStatusRows)).toBe(2)
    expect(sumCounterRows(loginRows)).toBe(3)
    expect(markerRows).toEqual([
      {
        id: 'unique-login:account-a',
        value: Math.floor(Date.UTC(2026, 4, 25) / 1000),
        bucketHour: null
      },
      {
        id: 'unique-login:account-b',
        value: Math.floor(Date.UTC(2026, 4, 18) / 1000),
        bucketHour: null
      }
    ])
  })

  it('adds historical buckets to live counters without double-counting live login markers', async () => {
    const liveCounterCreatedAt = new Date('2026-05-19T10:30:00.000Z')
    const liveWeek = Math.floor(Date.UTC(2026, 4, 18) / 1000)

    await database('counters').insert([
      {
        id: 'bucket:local-statuses:2026051910',
        value: 5,
        bucketHour: new Date('2026-05-19T10:00:00.000Z'),
        createdAt: liveCounterCreatedAt,
        updatedAt: liveCounterCreatedAt
      },
      {
        id: 'bucket:logins:2026051909',
        value: 3,
        bucketHour: new Date('2026-05-19T09:00:00.000Z'),
        createdAt: liveCounterCreatedAt,
        updatedAt: liveCounterCreatedAt
      },
      {
        id: 'unique-login:account-a',
        value: liveWeek,
        bucketHour: null,
        createdAt: liveCounterCreatedAt,
        updatedAt: liveCounterCreatedAt
      }
    ])
    await database('statuses').insert({
      id: 'live-status-after-counter',
      actorId: 'https://local.test/users/a',
      createdAt: new Date('2026-05-19T10:45:00.000Z'),
      updatedAt: new Date('2026-05-19T10:45:00.000Z')
    })
    await database('sessions').insert({
      id: 'historical-session-before-counter',
      accountId: 'account-b',
      token: 'token-before-counter',
      expireAt: new Date('2026-06-19T09:30:00.000Z'),
      createdAt: new Date('2026-05-19T09:30:00.000Z'),
      updatedAt: new Date('2026-05-19T09:30:00.000Z')
    })
    await database('sessions').insert({
      id: 'live-session-after-counter',
      accountId: 'account-a',
      token: 'token-live-after-counter',
      expireAt: new Date('2026-06-19T10:45:00.000Z'),
      createdAt: new Date('2026-05-19T10:45:00.000Z'),
      updatedAt: new Date('2026-05-19T10:45:00.000Z')
    })

    await migration.up(database)

    const statusBucket = await database('counters')
      .where('id', 'bucket:local-statuses:2026051910')
      .first()
    const loginBucket = await database('counters')
      .where('id', 'bucket:logins:2026051909')
      .first()
    const markerRows = await database('counters')
      .where('id', 'like', 'unique-login:%')
      .orderBy('id', 'asc')
      .select('id', 'value')

    expect(statusBucket?.value).toBe(6)
    expect(loginBucket?.value).toBe(4)
    expect(markerRows).toContainEqual({
      id: 'unique-login:account-a',
      value: liveWeek
    })
  })

  it('does not double-count bucket counters when the migration is rerun', async () => {
    await migration.up(database)

    const getBucketTotals = async () => {
      const localStatusRows = await database('counters')
        .where('id', 'like', 'bucket:local-statuses:%')
        .select('value')
      const loginRows = await database('counters')
        .where('id', 'like', 'bucket:logins:%')
        .select('value')

      return {
        localStatuses: sumCounterRows(localStatusRows),
        logins: sumCounterRows(loginRows)
      }
    }

    const firstRunTotals = await getBucketTotals()

    await migration.up(database)

    expect(await getBucketTotals()).toEqual(firstRunTotals)
  })

  it('writes up to 180 counter rows per chunk to reduce migration round trips', async () => {
    await database('statuses').delete()
    await database('sessions').delete()

    const statusRows = Array.from({ length: 180 }, (_, index) => {
      const createdAt = new Date(
        Date.UTC(2026, 0, 1, 0, 0, 0) + index * 60 * 60 * 1000
      )

      return {
        id: `chunk-status-${String(index).padStart(3, '0')}`,
        actorId: 'https://local.test/users/a',
        createdAt,
        updatedAt: createdAt
      }
    })

    await database('statuses').insert(statusRows)

    const queries: string[] = []
    const onQuery = (query: { sql: string }) => queries.push(query.sql)
    database.on('query', onQuery)

    try {
      await migration.up(database)
    } finally {
      database.off('query', onQuery)
    }

    const counterInsertQueries = queries.filter((query) =>
      query.startsWith('insert into `counters`')
    )

    expect(counterInsertQueries).toHaveLength(2)
  })

  it('removes instance activity counters on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    const remainingRows = await database('counters')
      .where('id', 'like', 'bucket:local-statuses:%')
      .orWhere('id', 'like', 'bucket:logins:%')
      .orWhere('id', 'like', 'unique-login:%')
      .orWhere('id', 'like', 'backfill:instance-activity:%')

    expect(remainingRows).toHaveLength(0)
  })

  it('backfills SQLite timestamp strings without timezone as UTC', async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = 'Europe/Amsterdam'

    try {
      await database('accounts').insert({
        id: 'account-sqlite-time',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })
      await database('actors').insert({
        id: 'https://local.test/users/sqlite-time',
        accountId: 'account-sqlite-time',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })
      await database('statuses').insert({
        id: 'sqlite-time-status',
        actorId: 'https://local.test/users/sqlite-time',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })
      await database('sessions').insert({
        id: 'sqlite-time-session',
        accountId: 'account-sqlite-time',
        token: 'sqlite-time-token',
        expireAt: '2026-06-25 00:30:00.000',
        createdAt: '2026-05-25 00:30:00.000',
        updatedAt: '2026-05-25 00:30:00.000'
      })

      await migration.up(database)

      const statusBucket = await database('counters')
        .where('id', 'bucket:local-statuses:2026052500')
        .first()
      const loginBucket = await database('counters')
        .where('id', 'bucket:logins:2026052500')
        .first()
      const marker = await database('counters')
        .where('id', 'unique-login:account-sqlite-time')
        .first()

      expect(statusBucket?.value).toBe(1)
      expect(loginBucket?.value).toBe(1)
      expect(marker?.value).toBe(Math.floor(Date.UTC(2026, 4, 25) / 1000))
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTimeZone
      }
    }
  })

  it.each(['userId', 'user_id'])(
    'backfills weekly logins from a singular session table using %s',
    async (sessionAccountColumn) => {
      await database.schema.dropTable('sessions')
      await database.schema.createTable('session', (table) => {
        table.string('id').primary()
        table.string(sessionAccountColumn).notNullable()
        table.string('token').notNullable()
        table.timestamp('expireAt', { useTz: true })
        table.timestamp('createdAt', { useTz: true })
        table.timestamp('updatedAt', { useTz: true })
      })

      await database('session').insert({
        id: `singular-session-${sessionAccountColumn}`,
        [sessionAccountColumn]: 'account-a',
        token: `singular-token-${sessionAccountColumn}`,
        expireAt: new Date('2026-06-19T09:00:00.000Z'),
        createdAt: new Date('2026-05-19T09:00:00.000Z'),
        updatedAt: new Date('2026-05-19T09:00:00.000Z')
      })

      await migration.up(database)

      const loginRows = await database('counters')
        .where('id', 'like', 'bucket:logins:%')
        .select('value')
      const marker = await database('counters')
        .where('id', 'unique-login:account-a')
        .first('id', 'value')

      expect(sumCounterRows(loginRows)).toBe(1)
      expect(marker).toEqual({
        id: 'unique-login:account-a',
        value: Math.floor(Date.UTC(2026, 4, 18) / 1000)
      })
    }
  )

  it('does not run in the default Knex migration transaction', () => {
    expect(migration.config).toEqual({ transaction: false })
  })

  it('builds MySQL activity-counter upserts without deprecated VALUES()', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const currentTime = new Date('2026-05-26T12:00:00.000Z')
    const row = {
      id: 'bucket:logins:2026052612',
      value: 1,
      bucketHour: currentTime,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    try {
      const bucketSql = migration
        .buildMySQLBucketCounterUpsertQuery(mysqlDatabase, [row])
        .toSQL().sql
      const markerSql = migration
        .buildMySQLLoginMarkerUpsertQuery(mysqlDatabase, [
          {
            ...row,
            id: 'unique-login:account-a',
            bucketHour: null
          }
        ])
        .toSQL().sql

      expect(bucketSql).toContain(' as `new_values` on duplicate key update ')
      expect(bucketSql).toContain(
        '`value` = `counters`.`value` + `new_values`.`value`'
      )
      expect(markerSql).toContain(
        'case when `new_values`.`value` > `counters`.`value`'
      )
      expect(bucketSql).not.toContain('VALUES(')
      expect(markerSql).not.toContain('VALUES(')
    } finally {
      await mysqlDatabase.destroy()
    }
  })
})
