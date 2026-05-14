import knex from 'knex'

import * as migration from '@/migrations/20260513000000_add_oauth_client_registration_metadata'

describe('OAuth client registration metadata migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('oauthClient', (table) => {
      table.string('clientId').primary()
    })
  })

  afterEach(async () => {
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

  test('adds an index for app registration rate-limit lookups', async () => {
    await migration.up(database)

    const indexes = await database.raw("PRAGMA index_list('oauthClient')")

    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'oauth_client_reference_id_idx'
      )
    ).toBe(true)
  })
})
