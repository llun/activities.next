import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const expectedBackend =
  process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

describe('createTestDatabase', () => {
  const testDatabase = createTestDatabase()
  const { database, db, knex } = testDatabase

  beforeAll(async () => {
    await testDatabase.prepare()
    await database.migrate()
  }, 30000)

  afterAll(async () => {
    await testDatabase.destroy()
  })

  it('defaults to the backend named by TEST_DATABASE_TYPE', () => {
    expect(testDatabase.backend).toBe(expectedBackend)
    expect(knex.client.config.client).toBe(
      expectedBackend === 'pg' ? 'pg' : 'better-sqlite3'
    )
  })

  it('migrate() loads the schema from the committed dump', async () => {
    // The table exists only if the dump was loaded; selecting would throw.
    await expect(
      db.selectFrom('server_settings').select('key').execute()
    ).resolves.toEqual([])
    await expect(database.getAllServerSettings()).resolves.toEqual([])
  })

  it('reads a row written through db via database', async () => {
    await db
      .insertInto('server_settings')
      .values({
        key: 'created.by.kysely',
        value: JSON.stringify('kysely'),
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .execute()

    await expect(database.getAllServerSettings()).resolves.toMatchObject([
      { key: 'created.by.kysely', value: 'kysely' }
    ])
  })

  it('reads a row written through database via db', async () => {
    await database.setServerSettings([
      { key: 'created.by.facade', value: 'facade' }
    ])

    const row = await db
      .selectFrom('server_settings')
      .selectAll()
      .where('key', '=', 'created.by.facade')
      .executeTakeFirstOrThrow()
    expect(JSON.parse(row.value)).toBe('facade')
  })
})

describe('createTestDatabase backends', () => {
  it('builds an in-memory SQLite database on request, with a no-op prepare', async () => {
    const testDatabase = createTestDatabase({ backend: 'sqlite' })
    expect(testDatabase.backend).toBe('sqlite')
    expect(await testDatabase.prepare()).toBeUndefined()
    await testDatabase.database.migrate()
    await expect(testDatabase.database.getAllServerSettings()).resolves.toEqual(
      []
    )
    await testDatabase.destroy()
  })

  it('destroy() closes the Knex pool', async () => {
    const testDatabase = createTestDatabase()
    await testDatabase.prepare()
    await testDatabase.database.migrate()
    await testDatabase.destroy()

    // Knex marks the pool destroyed; the pool no longer hands out connections.
    expect(testDatabase.knex.client.pool).toBeUndefined()
    await expect(
      testDatabase.db.selectFrom('server_settings').select('key').execute()
    ).rejects.toThrow()
  })
})
