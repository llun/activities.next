import knex from 'knex'

import * as migration from '@/migrations/20260513000000_add_oauth_client_registration_metadata'

describe('OAuth client registration metadata migration', () => {
  const database = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })

  beforeAll(async () => {
    await database.schema.createTable('oauthClient', (table) => {
      table.string('clientId').primary()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  test('adds registration metadata columns to existing oauth client tables', async () => {
    await migration.up(database)

    await expect(
      database.schema.hasColumn('oauthClient', 'referenceId')
    ).resolves.toBe(true)
    await expect(
      database.schema.hasColumn('oauthClient', 'metadata')
    ).resolves.toBe(true)
  })

  test('can run after the columns already exist', async () => {
    await expect(migration.up(database)).resolves.toBeUndefined()
  })
})
