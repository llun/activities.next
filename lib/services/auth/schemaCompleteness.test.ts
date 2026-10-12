import type { BetterAuthOptions } from '@better-auth/core'
import { getAuthTables } from '@better-auth/core/db'

import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'

// `kyselyAdapter` creates nothing on demand and filters no columns: `create`
// inserts whatever a better-auth plugin put in the record.
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
// `auth.ts` registers, and diffs that against the committed schema dump of the
// suite's backend (migrations/schema.sqlite.sql, or migrations/schema.sql on
// PostgreSQL) — which is what `lib/database/testing/createTestDatabase.ts`
// builds every test database from. Adding a plugin, or upgrading better-auth
// into new fields, fails here instead of in production.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`

const holder = vi.hoisted(() => ({ testDb: null as TestDatabase | null }))

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
  getKysely: () => holder.testDb?.db,
  getDatabase: () => null
}))

describe('better-auth schema completeness', () => {
  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    holder.testDb = testDb
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
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

    const db = holder.testDb?.db
    if (!db) throw new Error('The test database is not ready')
    const columnsByTable = new Map(
      (await db.introspection.getTables()).map((table) => [
        table.name,
        new Set(table.columns.map((column) => column.name))
      ])
    )

    const missing: string[] = []
    for (const [model, definition] of Object.entries(tables)) {
      const tableName = definition.modelName ?? model
      const columns = columnsByTable.get(tableName) ?? new Set<string>()

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
