import knexFactory, { type Knex } from 'knex'
import { noop } from 'lodash'

import { type Db, kyselyFor } from '@/lib/database/kysely'
import { getSQLDatabase } from '@/lib/database/sql'
import {
  TEST_PG_DATABASE,
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import {
  applyPostgresSchema,
  applySqliteSchema,
  withSchemaDumpMigrate
} from '@/lib/database/testing/schema'
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
  /** Kysely on the same pool, for seeding and fixtures. */
  db: Db
  /** The raw Knex instance behind `database` and `db`. */
  knex: Knex
  /** Drops and recreates the PostgreSQL database; a no-op on SQLite. */
  prepare: () => Promise<void> | void
  /** Closes the Knex pool (and so Kysely's). */
  destroy: () => Promise<void>
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
    const knex = knexFactory({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    return build({
      backend: 'sqlite',
      knex,
      loader: applySqliteSchema,
      prepare: noop
    })
  }

  // An isolated caller needs its OWN database, not the suite's: `prepare` drops
  // and recreates, so sharing the per-worker name would destroy the database
  // the surrounding suite is running against. ONE extra name per worker rather
  // than one per caller — Vitest runs a file's tests sequentially and each
  // isolated caller destroys its instance before the next begins, so reusing
  // the name keeps the server's database count bounded by the worker count
  // instead of growing with the number of such tests.
  const connection = getTestPgConnection()
  const databaseName = isolated
    ? `${TEST_PG_DATABASE}_isolated`
    : TEST_PG_DATABASE
  const knex = knexFactory({
    client: 'pg',
    connection: { ...connection, database: databaseName }
  })
  return build({
    backend: 'pg',
    knex,
    loader: applyPostgresSchema,
    prepare: () => recreatePgDatabase(connection, databaseName)
  })
}

const build = ({
  backend,
  knex,
  loader,
  prepare
}: {
  backend: TestDatabaseBackend
  knex: Knex
  loader: (instance: Knex) => Promise<void>
  prepare: () => Promise<void> | void
}): TestDatabase => ({
  backend,
  database: withSchemaDumpMigrate(getSQLDatabase(knex), knex, loader),
  // Lazy: kyselyFor() is only needed by suites that use it. testUtils.test.ts
  // builds this around a mocked Knex whose client kyselyFor() does not support.
  get db() {
    return kyselyFor(knex)
  },
  knex,
  prepare,
  destroy: () => knex.destroy()
})
