import knex from 'knex'

import * as migration from '@/migrations/20260821120000_better_auth_17_columns'

// The migration predates Better Auth 1.7.3 removing issuer from its account
// identity key. Keep these historical values fixed: this test protects the
// replayed migration, while the credential identity tests cover the current
// providerId/accountId lookup behaviour.
describe('better-auth 1.7 columns migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    // The pre-migration shape of both tables.
    await database.schema.createTable('account_providers', (table) => {
      table.string('id').primary()
      table.string('accountId')
      table.string('provider')
      table.string('providerId')
    })
    await database.schema.createTable('jwks', (table) => {
      table.string('id').primary()
      table.text('publicKey')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('backfills a credential row with its historical local issuer', async () => {
    await database('account_providers').insert({
      id: 'credential_acc-1',
      accountId: 'acc-1',
      provider: 'credential',
      providerId: 'acc-1'
    })

    await migration.up(database)

    const row = await database('account_providers')
      .where('id', 'credential_acc-1')
      .first()
    expect(row.issuer).toBe('local:credential')
  })

  it('backfills an external provider row with its historical OAuth namespace', async () => {
    await database('account_providers').insert({
      id: 'gh-1',
      accountId: 'acc-2',
      provider: 'github',
      providerId: '12345'
    })

    await migration.up(database)

    const row = await database('account_providers').where('id', 'gh-1').first()
    expect(row.issuer).toBe('local:oauth:github')
  })

  // The provider name is free text on this table, and better-auth
  // percent-encodes it so a name carrying `:` or `/` cannot forge another
  // issuer's namespace.
  it('encodes a provider name that is not URL-safe', async () => {
    await database('account_providers').insert({
      id: 'weird-1',
      accountId: 'acc-3',
      provider: 'my provider/x',
      providerId: '67890'
    })

    await migration.up(database)

    const row = await database('account_providers')
      .where('id', 'weird-1')
      .first()
    expect(row.issuer).toBe('local:oauth:my%20provider%2Fx')
  })

  it('leaves a row with no provider alone rather than inventing an issuer', async () => {
    await database('account_providers').insert({
      id: 'null-1',
      accountId: 'acc-4',
      provider: null,
      providerId: 'nope'
    })

    await migration.up(database)

    const row = await database('account_providers')
      .where('id', 'null-1')
      .first()
    expect(row.issuer).toBeNull()
  })

  it('adds the jwks columns the JWT plugin writes', async () => {
    await migration.up(database)

    await database('jwks').insert({
      id: 'key-1',
      publicKey: '{}',
      alg: 'RS256',
      crv: null
    })

    const row = await database('jwks').where('id', 'key-1').first()
    expect(row.alg).toBe('RS256')
  })

  it('drops both columns on down', async () => {
    await migration.up(database)
    await migration.down(database)

    expect(await database.schema.hasColumn('account_providers', 'issuer')).toBe(
      false
    )
    expect(await database.schema.hasColumn('jwks', 'alg')).toBe(false)
    expect(await database.schema.hasColumn('jwks', 'crv')).toBe(false)
  })
})
