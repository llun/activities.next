import type { Kysely } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import {
  type DatabaseBackend,
  createDatabaseConnection
} from '@/lib/database/connection'
import type { DB } from '@/lib/database/kysely'

export interface ScriptDatabase {
  /** Which database `db` is on. */
  backend: DatabaseBackend
  /** Kysely on the connection this call opened. */
  db: Kysely<DB>
  /** Closes the connection pool. Call it in a `finally`. */
  destroy: () => Promise<void>
}

/**
 * A connection of the script's own, for an operator script that does not run
 * on the app's shared one (it opens, uses and closes it, and may run beside the
 * app). `config` is `getConfig().database`.
 *
 * Only better-sqlite3 and pg are supported, as for the app: any other client
 * throws here, before anything connects.
 *
 * Unlike the app's connection it adds no sqlcommenter trace tag; a script has
 * no request to trace, so the app's connection adds none to a script's queries
 * either.
 *
 * Results are normalised like the app's (lib/database/kysely/normalize.ts)
 * unless `normalizeResults` is false: the production archive reads and writes
 * rows as they are stored.
 */
export const openScriptDatabase = (
  config: DatabaseConfig,
  { normalizeResults = true }: { normalizeResults?: boolean } = {}
): ScriptDatabase => {
  const { backend, db, destroy } = createDatabaseConnection(config, {
    normalizeResults
  })
  return { backend, db, destroy }
}
