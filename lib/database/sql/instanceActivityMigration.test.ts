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
        id: `unique-login:${Math.floor(
          Date.UTC(2026, 4, 18) / 1000
        )}:account-a`,
        value: 1,
        bucketHour: null
      },
      {
        id: `unique-login:${Math.floor(
          Date.UTC(2026, 4, 18) / 1000
        )}:account-b`,
        value: 1,
        bucketHour: null
      },
      {
        id: `unique-login:${Math.floor(
          Date.UTC(2026, 4, 25) / 1000
        )}:account-a`,
        value: 1,
        bucketHour: null
      }
    ])
  })

  it('removes instance activity counters on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    const remainingRows = await database('counters')
      .where('id', 'like', 'bucket:local-statuses:%')
      .orWhere('id', 'like', 'bucket:logins:%')
      .orWhere('id', 'like', 'unique-login:%')

    expect(remainingRows).toHaveLength(0)
  })
})
