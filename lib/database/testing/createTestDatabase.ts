import { noop } from 'lodash'

import type { DatabaseConfig } from '@/lib/config/database'
import { createDatabaseConnection } from '@/lib/database/connection'
import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import type { Db } from '@/lib/database/kysely'
import {
  TEST_PG_DATABASE,
  getTestPgConnection,
  preparePgDatabase,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import {
  type CaptureQueries,
  type OnQuery,
  createQueryCapture
} from '@/lib/database/testing/queryCapture'
import {
  getPostgresSchemaSql,
  loadSchemaDump
} from '@/lib/database/testing/schema'
import type { Database } from '@/lib/database/types'

export type TestDatabaseBackend = 'sqlite' | 'pg'

export type CreateTestDatabaseOptions = {
  /** Defaults to `pg` when `TEST_DATABASE_TYPE=pg`, otherwise `sqlite`. */
  backend?: TestDatabaseBackend
  /**
   * PostgreSQL only: use this worker's separate `_isolated` database, for a
   * suite whose `prepare()` resets (clears) the database, so sharing it would
   * wipe the surrounding suite's rows.
   */
  isolated?: boolean
}

export type TestDatabase = {
  backend: TestDatabaseBackend
  /**
   * The `Database` facade; `migrate()` loads the committed schema dump unless
   * this instance's `prepare()` already left it in place.
   */
  database: Database
  /** The root Kysely instance behind `database`, for seeding and fixtures. */
  db: Db
  /**
   * On PostgreSQL: empties the worker's database for the next test — a
   * `TRUNCATE` of the tables with rows when the schema still matches
   * `migrations/schema.sql` (first a fingerprint check, rebuilding from the
   * dump when it does not), after which `migrate()` is a no-op. A no-op on
   * SQLite.
   */
  prepare: () => Promise<void> | void
  /**
   * Drops and recreates the PostgreSQL database, for a suite that runs
   * migrations or loads a dump of its own instead of the committed schema
   * `prepare()` leaves behind. Afterwards `migrate()` loads the dump again. A
   * no-op on SQLite (where `migrate()` always loads the dump).
   */
  prepareEmpty: () => Promise<void> | void
  /** Closes the pool behind `database` and `db`. */
  destroy: () => Promise<void>
  /**
   * The statements the driver sends while `work` runs, as `{ sql, bindings }`
   * in the order sent, transaction statements included. See `CaptureQueries`.
   */
  captureQueries: CaptureQueries
  /** The lower-level hook under `captureQueries`; returns the unsubscribe. */
  onQuery: OnQuery
  /**
   * How many callers are queued for a connection from the pool: on SQLite the
   * ones waiting for the single connection, on PostgreSQL the ones waiting for
   * a free client. For a race test that has to know another caller is stuck.
   */
  pendingAcquires: () => number
}

/**
 * The way new tests get a database: `await prepare(); await database.migrate()`
 * in `beforeAll`, `await destroy()` in `afterAll`. Honours `TEST_DATABASE_TYPE`
 * unless `backend` is given, so a suite built on it runs on both backends.
 * On PostgreSQL `migrate()` after this instance's `prepare()` is a no-op: the
 * schema is already there.
 *
 * Seed or inspect state through `db` with the helpers in `./fixtures`.
 */
export const createTestDatabase = ({
  backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite',
  isolated = false
}: CreateTestDatabaseOptions = {}): TestDatabase => {
  if (backend !== 'pg') {
    return build({
      backend: 'sqlite',
      config: getTestDatabaseConfig('sqlite'),
      prepare: noop,
      prepareEmpty: noop
    })
  }
  const connection = getTestPgConnection()
  const databaseName = getTestPgDatabaseName(isolated)
  return build({
    backend: 'pg',
    config: getTestDatabaseConfig('pg', isolated),
    prepare: (executeScript) =>
      preparePgDatabase(connection, databaseName, () =>
        executeScript(getPostgresSchemaSql())
      ),
    prepareEmpty: () => recreatePgDatabase(connection, databaseName)
  })
}

/**
 * The connection configuration `createTestDatabase` uses: an in-memory SQLite
 * database, or this worker's PostgreSQL test database (which only exists once
 * a test database's `prepare()` has run). For a test that opens a connection
 * of its own with `createDatabaseConnection`.
 */
export const getTestDatabaseConfig = (
  backend: TestDatabaseBackend,
  isolated = false
): DatabaseConfig => {
  if (backend !== 'pg') {
    return {
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    }
  }
  // An isolated caller needs its OWN database, not the suite's: `prepare`
  // resets the worker's database, so sharing the per-worker name would wipe
  // the database the surrounding suite is running against. ONE extra name
  // per worker rather than one per caller — Vitest runs a file's tests
  // sequentially and each isolated caller destroys its instance before the
  // next begins, so reusing the name keeps the server's database count
  // bounded by the worker count instead of growing with the number of such
  // tests.
  return {
    client: 'pg',
    connection: {
      ...getTestPgConnection(),
      database: getTestPgDatabaseName(isolated)
    }
  }
}

/** The PostgreSQL database `createTestDatabase` uses in this worker. */
export const getTestPgDatabaseName = (isolated = false) =>
  isolated ? `${TEST_PG_DATABASE}_isolated` : TEST_PG_DATABASE

const build = ({
  backend,
  config,
  prepare,
  prepareEmpty
}: {
  backend: TestDatabaseBackend
  config: DatabaseConfig
  // Receives the connection's `executeScript`, so a PostgreSQL `prepare` can
  // replay the dump through the dedicated client it uses.
  prepare: (
    executeScript: (script: string) => Promise<void>
  ) => Promise<void> | void
  prepareEmpty: () => Promise<void> | void
}): TestDatabase => {
  // Only a PostgreSQL `prepare` leaves the dump's schema behind; SQLite's
  // no-op prepare must not stop `migrate()` from loading it.
  let schemaReady = false
  // Nothing connects until the first query.
  const connection = createDatabaseConnection(config)
  const wrappedPrepare = async () => {
    await prepare((script) => connection.executeScript(script))
    if (backend === 'pg') {
      schemaReady = true
    }
  }
  const wrappedPrepareEmpty = async () => {
    await prepareEmpty()
    // The database was dropped and recreated empty, so `migrate()` has to
    // load the dump again.
    if (backend === 'pg') {
      schemaReady = false
    }
  }
  const { onQuery, captureQueries } = createQueryCapture(connection.onQuery)
  return {
    backend,
    database: getSQLDatabase(connection.db, {
      migrate: async () => {
        if (schemaReady) {
          return
        }
        await loadSchemaDump(connection)
      },
      destroy: connection.destroy
    }),
    db: connection.db,
    prepare: wrappedPrepare,
    prepareEmpty: wrappedPrepareEmpty,
    destroy: connection.destroy,
    captureQueries,
    onQuery,
    pendingAcquires: connection.pendingAcquires
  }
}
