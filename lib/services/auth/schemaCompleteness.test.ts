import type { BetterAuthOptions } from '@better-auth/core'
import { getAuthTables } from '@better-auth/core/db'
import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `knexAdapter` creates nothing on demand and filters no columns: `create` does
// a bare `insert(record)` with whatever a better-auth plugin put in the record.
// So a field a plugin writes and our schema lacks is not a degraded feature, it
// is a failed INSERT — and better-auth swallows the driver error into a 500,
// which is how a better-auth 1.7 upgrade broke every OAuth sign-in with
// `table oauthConsent has no column named requestedUserInfoClaims` while the
// whole test suite stayed green.
//
// Nothing else catches this class. The CI "Schema Dump Sync" job regenerates
// the dumps FROM the migrations, so a migration that omits a column still
// produces a matching dump; and the suite never drives better-auth's real
// endpoints for most plugins.
//
// This asks better-auth itself what schema it expects, for the exact plugin set
// `auth.ts` registers, and diffs that against the committed SQLite dump — which
// is what `lib/database/testUtils.ts` builds every test database from, and is
// kept in lockstep with migrations/schema.sql. Adding a plugin, or upgrading
// better-auth into new fields, fails here instead of in production.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`

const holder = vi.hoisted(() => ({ knex: null as Knex | null }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: HOST,
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: [],
    auth: { enableCredential: true }
  }),
  getBaseURL: () => BASE_URL
}))

vi.mock('@/lib/database', () => ({
  getKnex: () => holder.knex,
  getDatabase: () => null
}))

const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)

describe('better-auth schema completeness', () => {
  let database: Knex

  beforeAll(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    const connection = await database.client.acquireConnection()
    try {
      connection.exec(readFileSync(SQLITE_SCHEMA_PATH, 'utf8'))
    } finally {
      await database.client.releaseConnection(connection)
    }
    holder.knex = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('provides every table and column the registered plugins declare', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    // `getAuthTables` resolves the core models plus every registered plugin's,
    // with our `modelName`/`fieldName` overrides already applied — so what it
    // returns is table and column names, not better-auth's abstract field names.
    // A concrete instance's `options` carries its plugin list as a literal
    // tuple, which better-auth's own plugin-registry generics make invariant
    // against the general `BetterAuthOptions` this helper takes. The cast is
    // the type system, not a claim about the value.
    const tables = getAuthTables(getAuth(BASE_URL).options as BetterAuthOptions)

    const missing: string[] = []
    for (const [model, definition] of Object.entries(tables)) {
      const tableName = definition.modelName ?? model
      const info = await database.raw(`pragma table_info(\`${tableName}\`)`)
      const columns = new Set((info as { name: string }[]).map((c) => c.name))

      if (columns.size === 0) {
        missing.push(`table ${tableName} (model ${model})`)
        continue
      }

      for (const [field, attributes] of Object.entries(definition.fields)) {
        const column = attributes.fieldName ?? field
        if (!columns.has(column)) {
          missing.push(
            `column ${tableName}.${column} (model ${model}.${field})`
          )
        }
      }
    }

    // Reported as a list rather than a bare toHaveLength so the failure names
    // exactly what to add to the migration.
    expect(missing).toEqual([])
  })
})
