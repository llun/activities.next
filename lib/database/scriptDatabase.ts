import knex, { type Knex } from 'knex'
import type { Kysely } from 'kysely'

import { getKnex } from '@/lib/database'
import { type DB, kyselyFor } from '@/lib/database/kysely'

export interface ScriptDatabase {
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
 * throws here, and the pool is closed first.
 *
 * Unlike the app's connection it has no sqlcommenter hook attached; a script
 * has no request to trace, so the app's connection adds no trace tag to a
 * script's queries either.
 */
export const openScriptDatabase = (config: Knex.Config): ScriptDatabase => {
  const instance = knex(config)
  try {
    return { db: kyselyFor(instance), destroy: () => instance.destroy() }
  } catch (error) {
    void instance.destroy()
    throw error
  }
}

/**
 * The app's shared connection (the one `getDatabase()` uses) as Kysely, for a
 * script that already needs the `Database` facade. The script closes it with
 * `database.destroy()`, not with a destroy of its own.
 */
export const getScriptKysely = (): Kysely<DB> => kyselyFor(getKnex())
