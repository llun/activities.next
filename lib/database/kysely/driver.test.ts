import type { Knex } from 'knex'
import { sql } from 'kysely'

import { kyselyFor } from '@/lib/database/kysely'
import { getKyselyDialectName } from '@/lib/database/kysely/driver'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// Runs on SQLite by default and on PostgreSQL under TEST_DATABASE_TYPE=pg.
describe('Knex-backed Kysely driver', () => {
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

  it('reads timestamps written by Knex as epoch milliseconds', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.678Z')
    await instance('likes').insert({
      actorId: 'driver-actor-1',
      statusId: 'driver-status-1',
      createdAt,
      updatedAt: createdAt
    })

    const row = await kyselyFor(instance)
      .selectFrom('likes')
      .select(['createdAt', 'updatedAt'])
      .where('actorId', '=', 'driver-actor-1')
      .executeTakeFirstOrThrow()

    expect(row).toEqual({
      createdAt: createdAt.getTime(),
      updatedAt: createdAt.getTime()
    })
  })

  it('reads a CURRENT_TIMESTAMP column default as epoch milliseconds', async () => {
    const before = Math.floor(Date.now() / 1000) * 1000
    await instance('likes').insert({
      actorId: 'driver-actor-2',
      statusId: 'driver-status-2'
    })

    const row = await kyselyFor(instance)
      .selectFrom('likes')
      .select('createdAt as at')
      .where('actorId', '=', 'driver-actor-2')
      .executeTakeFirstOrThrow()

    expect(typeof row.at).toBe('number')
    expect(row.at).toBeGreaterThanOrEqual(before)
    expect(row.at).toBeLessThanOrEqual(Date.now())
  })

  it('binds Date and boolean values the same way Knex does', async () => {
    const createdAt = new Date('2026-02-03T04:05:06.789Z')
    const db = kyselyFor(instance)
    await db
      .insertInto('customEmojis')
      .values({
        id: 'driver-emoji-1',
        shortcode: 'driver_one',
        url: 'https://llun.test/one.png',
        staticUrl: 'https://llun.test/one.png',
        disabled: true,
        visibleInPicker: false,
        createdAt,
        updatedAt: createdAt
      })
      .execute()
    await instance('customEmojis').insert({
      id: 'driver-emoji-2',
      shortcode: 'driver_two',
      url: 'https://llun.test/two.png',
      staticUrl: 'https://llun.test/two.png',
      disabled: true,
      visibleInPicker: false,
      createdAt,
      updatedAt: createdAt
    })

    // Both rows are stored identically, whichever library wrote them.
    const raw = await instance('customEmojis')
      .select('disabled', 'visibleInPicker', 'createdAt')
      .whereIn('id', ['driver-emoji-1', 'driver-emoji-2'])
      .orderBy('id')
    expect(raw[0]).toEqual(raw[1])

    const rows = await db
      .selectFrom('customEmojis')
      .select(['disabled', 'visibleInPicker', 'createdAt'])
      .where('id', 'in', ['driver-emoji-1', 'driver-emoji-2'])
      .execute()
    expect(rows).toEqual([
      {
        disabled: true,
        visibleInPicker: false,
        createdAt: createdAt.getTime()
      },
      { disabled: true, visibleInPicker: false, createdAt: createdAt.getTime() }
    ])
  })

  it('reads JSON parsed and bigint counters as numbers', async () => {
    const db = kyselyFor(instance)
    await db
      .insertInto('status_history')
      .values({
        statusId: 'driver-status-3',
        data: JSON.stringify({ text: 'hello', tags: ['a'] })
      })
      .execute()
    await instance('counters').insert({
      id: 'driver-counter',
      value: 42,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const history = await db
      .selectFrom('status_history')
      .select('data')
      .where('statusId', '=', 'driver-status-3')
      .executeTakeFirstOrThrow()
    const counter = await db
      .selectFrom('counters')
      .select('value')
      .where('id', '=', 'driver-counter')
      .executeTakeFirstOrThrow()

    expect(history.data).toEqual({ text: 'hello', tags: ['a'] })
    expect(counter.value).toBe(42)
  })

  it('reports affected rows', async () => {
    const result = await kyselyFor(instance)
      .deleteFrom('likes')
      .where('actorId', 'in', ['driver-actor-1', 'driver-actor-2'])
      .executeTakeFirst()
    expect(result.numDeletedRows).toBe(BigInt(2))
  })

  it('announces Kysely statements on the Knex query events', async () => {
    const queries: { sql: string; bindings: unknown[] }[] = []
    const errors: string[] = []
    const onQuery = ({ sql, bindings }: { sql: string; bindings: unknown[] }) =>
      queries.push({ sql, bindings })
    const onError = (_error: Error, { sql }: { sql: string }) =>
      errors.push(sql)
    instance.on('query', onQuery)
    instance.on('query-error', onError)
    try {
      await kyselyFor(instance)
        .selectFrom('likes')
        .select('statusId')
        .where('actorId', '=', 'driver-events')
        .execute()
      await expect(
        sql`select * from no_such_table`.execute(kyselyFor(instance))
      ).rejects.toThrow()
    } finally {
      instance.off('query', onQuery)
      instance.off('query-error', onError)
    }

    expect(queries).toHaveLength(2)
    expect(queries[0].sql).toMatch(/^select "statusId" from "likes" where/)
    expect(queries[0].bindings).toEqual(['driver-events'])
    expect(errors).toEqual(['select * from no_such_table'])
  })

  it('leaves the Knex pool open when the Kysely instance is destroyed', async () => {
    const test = getTestDatabaseWithInstance(true)
    await test.prepare()
    await test.database.migrate()
    try {
      await kyselyFor(test.instance).destroy()
      await expect(
        kyselyFor(test.instance).selectFrom('likes').selectAll().execute()
      ).rejects.toThrow('destroyed')
      await expect(test.instance('likes').count()).resolves.toBeDefined()
    } finally {
      await test.database.destroy()
    }
  })
})

describe('getKyselyDialectName', () => {
  it.each([
    { client: 'better-sqlite3', dialect: 'sqlite3', expected: 'sqlite' },
    { client: 'pg', dialect: 'postgresql', expected: 'postgres' }
  ])('maps $client to $expected', ({ client, dialect, expected }) => {
    expect(
      getKyselyDialectName({ dialect, driverName: client } as Knex.Client)
    ).toBe(expected)
  })

  it.each([
    { client: 'mysql2', dialect: 'mysql' },
    { client: 'mysql', dialect: 'mysql' },
    { client: 'sqlite3', dialect: 'sqlite3' },
    { client: 'pgnative', dialect: 'postgresql' }
  ])('names the unsupported $client driver', ({ client, dialect }) => {
    expect(() =>
      getKyselyDialectName({ dialect, driverName: client } as Knex.Client)
    ).toThrow(`Knex "${dialect}" dialect with the "${client}" driver`)
  })
})
