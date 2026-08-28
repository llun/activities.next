import knex from 'knex'

import { toClientCredentialsScopes } from '@/lib/services/oauth/clientCredentialsScopes'
import * as migration from '@/migrations/20260828000000_backfill_oauth_client_credentials_scopes'

// The table is created with only the columns the migration reads and writes,
// like the other `oauthClient` migration tests. That the column NAMES match the
// real schema is proved separately and more strongly by
// `lib/services/auth/oauthProviderFlow.test.ts`, which registers through
// `createApplication` against the committed SQLite dump and exchanges the
// resulting credentials for an app token.
const createOAuthClientTable = async (database: knex.Knex) => {
  await database.schema.createTable('oauthClient', (table) => {
    table.string('id').primary()
    table.text('scopes').nullable()
    table.text('grantTypes').nullable()
    table.string('tokenEndpointAuthMethod').nullable()
    table.text('clientCredentialsScopes').nullable()
  })
}

const MASTODON_GRANT_TYPES = JSON.stringify([
  'authorization_code',
  'client_credentials',
  'refresh_token'
])

describe('backfill oauth client credentials scopes migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await createOAuthClientTable(database)
  })

  afterEach(async () => {
    await database.destroy()
  })

  const readScopes = async (id: string) => {
    const row = await database('oauthClient')
      .where('id', id)
      .first('clientCredentialsScopes')
    return row?.clientCredentialsScopes ?? null
  }

  it('gives an application registered through /api/v1/apps its own scopes', async () => {
    await database('oauthClient').insert({
      id: 'mastodon-client',
      scopes: JSON.stringify(['read', 'write', 'follow', 'push']),
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'client_secret_post',
      clientCredentialsScopes: null
    })

    await migration.up(database)

    expect(await readScopes('mastodon-client')).toBe(
      JSON.stringify(['read', 'write', 'follow', 'push'])
    )
  })

  it.each([
    {
      description:
        'drops the scopes better-auth reserves for user-delegated grants',
      scopes: JSON.stringify(['openid', 'profile', 'email', 'read', 'write']),
      expected: ['read', 'write']
    },
    {
      description: 'deduplicates repeated scopes',
      scopes: JSON.stringify(['read', 'read', 'write']),
      expected: ['read', 'write']
    },
    {
      description: 'reads a space-separated scope string',
      scopes: 'read write follow',
      expected: ['read', 'write', 'follow']
    },
    {
      description: 'denies the grant to an OpenID-only client',
      scopes: JSON.stringify(['openid', 'email']),
      expected: []
    },
    {
      description: 'denies the grant to a client with no scopes recorded',
      scopes: null,
      expected: []
    }
  ])('$description', async ({ scopes, expected }) => {
    await database('oauthClient').insert({
      id: 'client',
      scopes,
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'client_secret_post',
      clientCredentialsScopes: null
    })

    await migration.up(database)

    expect(await readScopes('client')).toBe(JSON.stringify(expected))
  })

  it.each([
    {
      description: 'a client not registered for the grant',
      grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
      tokenEndpointAuthMethod: 'client_secret_post'
    },
    {
      description: 'a client with no grant types recorded',
      grantTypes: null,
      tokenEndpointAuthMethod: 'client_secret_post'
    },
    {
      description: 'a public client, which better-auth refuses the grant',
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'none'
    }
  ])(
    'denies the grant to $description',
    async ({ grantTypes, tokenEndpointAuthMethod }) => {
      await database('oauthClient').insert({
        id: 'client',
        scopes: JSON.stringify(['read', 'write']),
        clientCredentialsScopes: null,
        grantTypes,
        tokenEndpointAuthMethod
      })

      await migration.up(database)

      expect(await readScopes('client')).toBe('[]')
    }
  )

  it('leaves a client that already has a ceiling untouched', async () => {
    await database('oauthClient').insert({
      id: 'configured',
      scopes: JSON.stringify(['read', 'write']),
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'client_secret_post',
      clientCredentialsScopes: JSON.stringify(['read'])
    })

    await migration.up(database)

    expect(await readScopes('configured')).toBe(JSON.stringify(['read']))
  })

  it('is idempotent', async () => {
    await database('oauthClient').insert({
      id: 'client',
      scopes: JSON.stringify(['read', 'write']),
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'client_secret_post',
      clientCredentialsScopes: null
    })

    await migration.up(database)
    await migration.up(database)

    expect(await readScopes('client')).toBe(JSON.stringify(['read', 'write']))
  })

  // Registrations are never garbage collected, so this table only grows and the
  // backfill pages through it. At fixture scale one page and several are
  // indistinguishable by result, so count the SELECTs: 501 rows must be read as
  // 500 + 1, plus the empty page that ends the loop.
  it('pages through more rows than one batch holds', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      // Zero-pad so the id ordering the migration selects by is stable, and the
      // last row inserted is not also the last row read.
      id: `client-${String(index).padStart(4, '0')}`,
      scopes: JSON.stringify(['read']),
      grantTypes: MASTODON_GRANT_TYPES,
      tokenEndpointAuthMethod: 'client_secret_post',
      clientCredentialsScopes: null
    }))
    // SQLite caps a compound SELECT at 500 terms, which is what knex compiles a
    // multi-row insert to, so seed in chunks well under it.
    for (let index = 0; index < rows.length; index += 100) {
      await database('oauthClient').insert(rows.slice(index, index + 100))
    }

    const selects: string[] = []
    database.on('query', ({ sql }: { sql: string }) => {
      if (sql.trimStart().toLowerCase().startsWith('select')) selects.push(sql)
    })

    await migration.up(database)

    expect(selects).toHaveLength(3)
    await expect(
      database('oauthClient').whereNull('clientCredentialsScopes').count({
        remaining: '*'
      })
    ).resolves.toEqual([{ remaining: 0 }])
  })

  // `whereIn('id', [null])` matches nothing, so a row with no id would be read
  // on every pass and never written — the loop's termination argument rests on
  // every read row being written. Nothing writes such a row (`id` is NOT NULL on
  // PostgreSQL) but SQLite permits it in a non-INTEGER primary key, and a
  // migration that spins holds the knex migration lock for as long as it runs.
  // Without the skip this test hangs rather than failing.
  // A row with no id is invisible to `whereIn('id', …)`, so it is read on every
  // pass and never written — which breaks the loop's termination argument that
  // every row a page reads is written. Nothing writes such a row (`id` is NOT
  // NULL on PostgreSQL) but SQLite permits it in a non-INTEGER primary key, and
  // a migration that spins holds the knex migration lock for as long as it runs.
  //
  // The statement budget is what makes this test useful rather than dangerous.
  // better-sqlite3 is synchronous, so a spinning migration never yields to the
  // event loop and vitest's own 30s timeout can never fire — a regression would
  // stall the whole CI shard instead of failing. Throwing from the `query`
  // listener converts the spin into an immediate, legible failure.
  it('terminates when a row has no id, and still repairs the rest', async () => {
    await database('oauthClient').insert([
      {
        id: null,
        scopes: JSON.stringify(['read']),
        grantTypes: MASTODON_GRANT_TYPES,
        tokenEndpointAuthMethod: 'client_secret_post',
        clientCredentialsScopes: null
      },
      {
        id: 'client',
        scopes: JSON.stringify(['read', 'write']),
        grantTypes: MASTODON_GRANT_TYPES,
        tokenEndpointAuthMethod: 'client_secret_post',
        clientCredentialsScopes: null
      }
    ])

    // Two rows need one SELECT, one UPDATE and one terminating SELECT. Anything
    // approaching this many statements is a migration that is not converging.
    const STATEMENT_BUDGET = 20
    let statements = 0
    database.on('query', () => {
      statements += 1
      if (statements > STATEMENT_BUDGET) {
        throw new Error(
          `migration issued more than ${STATEMENT_BUDGET} statements; it is not terminating`
        )
      }
    })

    await expect(migration.up(database)).resolves.toBeUndefined()

    expect(await readScopes('client')).toBe(JSON.stringify(['read', 'write']))
  })

  // The migration cannot import the helper the registration path uses — it runs
  // through the plain knex CLI, with no TypeScript loader and no path aliases —
  // so the two carry the same rule twice. A client repaired here and a client
  // registered after the fix must end up with the same ceiling, or the bug comes
  // back for whichever half drifted.
  it('agrees with the helper the registration path uses', async () => {
    const scopeSets = [
      ['read', 'write', 'follow', 'push'],
      ['openid', 'profile', 'email', 'offline_access', 'read'],
      ['read', 'read', 'write'],
      ['read:statuses', 'write:media', 'admin:read:reports'],
      ['openid'],
      []
    ]
    await database('oauthClient').insert(
      scopeSets.map((scopes, index) => ({
        id: `client-${index}`,
        scopes: JSON.stringify(scopes),
        grantTypes: MASTODON_GRANT_TYPES,
        tokenEndpointAuthMethod: 'client_secret_post',
        clientCredentialsScopes: null
      }))
    )

    await migration.up(database)

    const migrated = await Promise.all(
      scopeSets.map((_, index) => readScopes(`client-${index}`))
    )
    expect(migrated).toEqual(
      scopeSets.map((scopes) =>
        JSON.stringify(toClientCredentialsScopes(scopes))
      )
    )
  })
})
