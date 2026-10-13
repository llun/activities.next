import type { Kysely } from 'kysely'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import type { DatabaseConfig } from '@/lib/config/database'
import {
  type DatabaseHandle,
  createDatabaseConnection
} from '@/lib/database/connection'
import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import type { DB } from '@/lib/database/kysely'
import { Database } from '@/lib/database/types'

interface DatabaseInstance {
  database: Database
  connection: DatabaseHandle
}

// `yarn migrate` is how migrations run; nothing in the app calls `migrate()`.
// It runs the same migrations through lib/database/migrate, imported on first
// use so neither the runner nor the migrations join the server bundle.
const migrateDatabase = async (db: Kysely<DB>, config: DatabaseConfig) => {
  const { migrateToLatest } = await import('@/lib/database/migrate')
  await migrateToLatest({ db, config })
}

const getDatabaseInstance = memoize((): DatabaseInstance | null => {
  const config = getConfig()
  // Only better-sqlite3 and pg are supported; an unsupported client fails
  // here, at startup, rather than on the first request.
  const connection = createDatabaseConnection(config.database, {
    sqlcommenter: true
  })
  return {
    connection,
    database: getSQLDatabase(connection.db, {
      migrate: () => migrateDatabase(connection.db, config.database),
      destroy: connection.destroy
    })
  }
})

/**
 * The application's Kysely instance, for code outside the `Database` facade
 * (the better-auth adapter and the operator scripts). It is the facade's own
 * instance, so a script closes it with `database.destroy()`.
 */
export const getKysely = (): Kysely<DB> => {
  const instance = getDatabaseInstance()
  if (!instance) {
    throw new Error('Database not initialized')
  }
  return instance.connection.db
}

export const getDatabase = (): Database | null => {
  return getDatabaseInstance()?.database ?? null
}
