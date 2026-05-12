import knex from 'knex'

import * as migration from '@/migrations/20260512230000_require_pkce_for_oauth_clients'

describe('require PKCE for OAuth clients migration', () => {
  const database = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })

  beforeAll(async () => {
    await database.schema.createTable('oauthClient', (table) => {
      table.string('clientId').primary()
      table.boolean('requirePKCE').nullable()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  test('upgrades existing oauth clients to require PKCE', async () => {
    await database('oauthClient').insert([
      { clientId: 'pkce-disabled', requirePKCE: false },
      { clientId: 'pkce-null', requirePKCE: null },
      { clientId: 'pkce-enabled', requirePKCE: true }
    ])

    await migration.up(database)

    const clients = await database('oauthClient')
      .select('clientId', 'requirePKCE')
      .orderBy('clientId')

    expect(clients).toEqual([
      { clientId: 'pkce-disabled', requirePKCE: 1 },
      { clientId: 'pkce-enabled', requirePKCE: 1 },
      { clientId: 'pkce-null', requirePKCE: 1 }
    ])
  })
})
