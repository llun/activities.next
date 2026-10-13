import { noop } from 'lodash'

import type { DatabaseConfig } from '@/lib/config/database'
import { createDatabaseConnection } from '@/lib/database/connection'
import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import type { Db } from '@/lib/database/kysely'
import {
  TEST_PG_DATABASE,
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import {
  type CaptureQueries,
  type OnQuery,
  createQueryCapture
} from '@/lib/database/testing/queryCapture'
import { loadSchemaDump } from '@/lib/database/testing/schema'
import type { Database } from '@/lib/database/types'

export type TestDatabaseBackend = 'sqlite' | 'pg'

export type CreateTestDatabaseOptions = {
  /** Defaults to `pg` when `TEST_DATABASE_TYPE=pg`, otherwise `sqlite`. */
  backend?: TestDatabaseBackend
  /**
   * PostgreSQL only: use this worker's separate `_isolated` database, for a
   * suite whose `prepare()` must not drop the database the surrounding suite
   * is running against.
   */
  isolated?: boolean
}

export type TestDatabase = {
  backend: TestDatabaseBackend
  /** The `Database` facade; `migrate()` loads the committed schema dump. */
  database: Database
  /** The root Kysely instance behind `database`, for seeding and fixtures. */
  db: Db
  /** Drops and recreates the PostgreSQL database; a no-op on SQLite. */
  prepare: () => Promise<void> | void
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
      prepare: noop
    })
  }
  const connection = getTestPgConnection()
  const databaseName = getTestPgDatabaseName(isolated)
  return build({
    backend: 'pg',
    config: getTestDatabaseConfig('pg', isolated),
    prepare: () => recreatePgDatabase(connection, databaseName)
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
  // An isolated caller needs its OWN database, not the suite's: `prepare` drops
  // and recreates, so sharing the per-worker name would destroy the database
  // the surrounding suite is running against. ONE extra name per worker rather
  // than one per caller — Vitest runs a file's tests sequentially and each
  // isolated caller destroys its instance before the next begins, so reusing
  // the name keeps the server's database count bounded by the worker count
  // instead of growing with the number of such tests.
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
  prepare
}: {
  backend: TestDatabaseBackend
  config: DatabaseConfig
  prepare: () => Promise<void> | void
}): TestDatabase => {
  // Nothing connects until the first query.
  const connection = createDatabaseConnection(config)
  const { onQuery, captureQueries } = createQueryCapture(connection.onQuery)
  return {
    backend,
    database: getSQLDatabase(connection.db, {
      migrate: () => loadSchemaDump(connection),
      destroy: connection.destroy
    }),
    db: connection.db,
    prepare,
    destroy: connection.destroy,
    captureQueries,
    onQuery,
    pendingAcquires: connection.pendingAcquires
  }
}
