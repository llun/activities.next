import type { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Database } from '@/lib/database/types'

// Tests build their schema from the committed reference dumps instead of running
// the Knex migration chain. This keeps the (ESM) migration files out of the test
// runtime entirely and makes per-file database setup dramatically faster. The
// dumps are kept in lockstep with the migrations (see AGENTS.md), so the schema
// is identical to a fully-migrated database.
const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)
const POSTGRES_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sql', import.meta.url)
)

export const applySqliteSchema = async (instance: Knex) => {
  const sql = readFileSync(SQLITE_SCHEMA_PATH, 'utf8')
  const connection = await instance.client.acquireConnection()
  try {
    // better-sqlite3 exposes a synchronous multi-statement `exec`.
    connection.exec(sql)
  } finally {
    await instance.client.releaseConnection(connection)
  }
}

export const applyPostgresSchema = async (instance: Knex) => {
  const sql = readFileSync(POSTGRES_SCHEMA_PATH, 'utf8')
  // pg_dump opens the dump with `SELECT pg_catalog.set_config('search_path', '',
  // false)`. The `false` makes it *session*-scoped rather than transaction-scoped,
  // so it outlives the load: the pooled connection that ran the dump keeps an
  // empty search_path for the rest of its life. Every table in the dump is
  // `public.`-qualified and so is created fine, but any later unqualified query
  // that the pool happens to route back to that connection cannot resolve it
  // (`relation "accounts" does not exist`). Hold one connection for both
  // statements so the reset lands on the connection that was poisoned — knex's
  // own `searchPath` config would not do, as it is applied when a connection is
  // created, which is before the dump runs. `RESET` restores the server default
  // (`"$user", public`), leaving this connection identical to a freshly created
  // one rather than pinning it to a hardcoded schema list.
  const connection = await instance.client.acquireConnection()
  try {
    await instance.raw(sql).connection(connection)
    await instance.raw('RESET search_path').connection(connection)
  } finally {
    await instance.client.releaseConnection(connection)
  }
}

// Replaces the production `migrate()` (which runs Knex migrations) with a fast
// schema-dump loader for the test database instance.
export const withSchemaDumpMigrate = (
  database: Database,
  instance: Knex,
  loader: (instance: Knex) => Promise<void>
): Database => {
  database.migrate = () => loader(instance)
  return database
}
