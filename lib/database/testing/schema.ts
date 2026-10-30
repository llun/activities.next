import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { DatabaseHandle } from '@/lib/database/connection'

// Tests build their schema from the committed reference dumps instead of running
// the migrations. This keeps the migrations out of the test runtime and makes
// per-file database setup dramatically faster. The dumps are kept in lockstep
// with the migrations (see docs/setup.md → Database Backends & Local Setup),
// so the schema is identical to a
// fully-migrated database; their `kysely_migration` table is empty, so a test
// database is not one `yarn migrate` would run on.
const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)
const POSTGRES_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sql', import.meta.url)
)

/**
 * Loads the committed schema dump for the connection's backend: through
 * better-sqlite3's multi-statement `exec` on SQLite, and on a PostgreSQL client
 * of its own (see `executeScript`). pg_dump opens its dump with
 * `set_config('search_path', '', false)`, a session setting; that client is
 * closed afterwards, so no pooled connection keeps the empty search_path.
 */
export const loadSchemaDump = async (connection: DatabaseHandle) => {
  const path =
    connection.backend === 'pg' ? POSTGRES_SCHEMA_PATH : SQLITE_SCHEMA_PATH
  await connection.executeScript(readFileSync(path, 'utf8'))
}
