import { Knex } from 'knex'
import knex from 'knex'
import { noop } from 'lodash'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client as PostgresClient } from 'pg'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// Tests build their schema from the committed reference dumps instead of running
// the Knex migration chain. This keeps the (ESM) migration files out of the test
// runtime entirely and makes per-file database setup dramatically faster. The
// dumps are kept in lockstep with the migrations (see AGENTS.md), so the schema
// is identical to a fully-migrated database.
const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../migrations/schema.sqlite.sql', import.meta.url)
)
const POSTGRES_SCHEMA_PATH = fileURLToPath(
  new URL('../../migrations/schema.sql', import.meta.url)
)

const applySqliteSchema = async (instance: Knex) => {
  const sql = readFileSync(SQLITE_SCHEMA_PATH, 'utf8')
  const connection = await instance.client.acquireConnection()
  try {
    // better-sqlite3 exposes a synchronous multi-statement `exec`.
    connection.exec(sql)
  } finally {
    await instance.client.releaseConnection(connection)
  }
}

const applyPostgresSchema = async (instance: Knex) => {
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
const withSchemaDumpMigrate = (
  database: Database,
  instance: Knex,
  loader: (instance: Knex) => Promise<void>
): Database => {
  database.migrate = () => loader(instance)
  return database
}

// Each Vitest worker needs its own PostgreSQL database. `prepare()` drops and
// recreates the database before loading the schema, so a single shared name lets
// one worker destroy the database another worker is running tests against — which
// surfaces as `relation "..." does not exist` or `Connection terminated
// unexpectedly` in whichever file lost the race. Vitest hands files to a worker
// one at a time, so a name per worker is enough isolation; `VITEST_POOL_ID` is
// unique across the workers running concurrently. Strip it to digits: it is
// interpolated into `CREATE`/`DROP DATABASE`, which cannot be parameterised.
const TEST_PG_WORKER_ID = (process.env.VITEST_POOL_ID ?? '').replace(/\D/g, '')
const TEST_PG_DATABASE = TEST_PG_WORKER_ID
  ? `test_${TEST_PG_WORKER_ID}`
  : 'test'
const TEST_PG_CONNECTION = {
  host: process.env.TEST_DATABASE_HOST,
  port: 5432,
  user: process.env.TEST_DATABASE_USERNAME,
  password: process.env.TEST_DATABASE_PASSWORD
}

export type PrepareFunction = () => Promise<void> | void
export type TestDatabaseTableItem = [string, Database, PrepareFunction]
export type TestDatabaseTable = TestDatabaseTableItem[]

type GetTestDatabase = () => {
  name: string
  database: Database
  prepare: () => Promise<void> | void
}

const DATABASES: Record<string, GetTestDatabase> = {
  sqlite: () => {
    const instance = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    return {
      name: 'sqlite',
      database: withSchemaDumpMigrate(
        getSQLDatabase(instance),
        instance,
        applySqliteSchema
      ),
      prepare: noop
    }
  },
  pg: () => {
    const instance = knex({
      client: 'pg',
      connection: {
        ...TEST_PG_CONNECTION,
        database: TEST_PG_DATABASE
      }
    })
    return {
      name: 'pg',
      database: withSchemaDumpMigrate(
        getSQLDatabase(instance),
        instance,
        applyPostgresSchema
      ),
      prepare: async () => {
        const client = new PostgresClient({
          ...TEST_PG_CONNECTION,
          database: 'postgres'
        })
        await client.connect()
        await client.query(
          `DROP DATABASE IF EXISTS ${TEST_PG_DATABASE} WITH (FORCE)`
        )
        await client.query(`CREATE DATABASE ${TEST_PG_DATABASE}`)
        await client.end()
      }
    }
  }
}

export const getTestDatabaseTable = (): TestDatabaseTable => {
  switch (process.env.TEST_DATABASE_TYPE) {
    case 'sqlite':
    case 'pg': {
      const { name, database, prepare } =
        DATABASES[process.env.TEST_DATABASE_TYPE]()
      return [[name, database, prepare]]
    }
    default: {
      const sqlite = DATABASES.sqlite()
      return [[sqlite.name, sqlite.database, sqlite.prepare]]
    }
  }
}

export const databaseBeforeAll = async (table: TestDatabaseTable) => {
  await Promise.all(
    table.map(async (item) => {
      const [, database, prepare] = item
      await prepare()
      await database.migrate()
    })
  )
}

/**
 * A database honouring `TEST_DATABASE_TYPE`, plus its raw Knex instance and the
 * `prepare` step PostgreSQL needs, for a suite that is not shaped as a
 * `describe.each` over `getTestDatabaseTable()` but still has to run on both
 * backends.
 *
 * `getTestSQLDatabase` and `getTestSQLDatabaseWithInstance` below are
 * SQLite-ONLY and ignore `TEST_DATABASE_TYPE` entirely — which is a trap worth
 * knowing about, because a suite built on them reports a clean run under the
 * pg environment variables without ever opening a PostgreSQL connection. Use
 * this instead wherever the SQL under test has to agree across backends.
 */
export const getTestDatabaseWithInstance = (
  isolated = false,
  backend = process.env.TEST_DATABASE_TYPE
) => {
  if (backend !== 'pg') {
    const { database, instance } = getTestSQLDatabaseWithInstance()
    return { database, instance, prepare: noop as PrepareFunction }
  }

  // An isolated caller needs its OWN database, not the suite's: `prepare` drops
  // and recreates, so sharing the per-worker name would destroy the database
  // the surrounding suite is running against. ONE extra name per worker rather
  // than one per caller — Vitest runs a file's tests sequentially and each
  // isolated caller destroys its instance before the next begins, so reusing
  // the name keeps the server's database count bounded by the worker count
  // instead of growing with the number of such tests.
  const databaseName = isolated
    ? `${TEST_PG_DATABASE}_isolated`
    : TEST_PG_DATABASE

  const instance = knex({
    client: 'pg',
    connection: { ...TEST_PG_CONNECTION, database: databaseName }
  })
  return {
    database: withSchemaDumpMigrate(
      getSQLDatabase(instance),
      instance,
      applyPostgresSchema
    ),
    instance,
    prepare: async () => {
      const client = new PostgresClient({
        ...TEST_PG_CONNECTION,
        database: 'postgres'
      })
      await client.connect()
      await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
      await client.query(`CREATE DATABASE ${databaseName}`)
      await client.end()
    }
  }
}

// Build a fresh in-memory SQLite database and also hand back the raw Knex
// instance, for the rare test that needs to seed a state the public Database
// interface cannot construct (e.g. a registration-pending account row with a
// null approvedAt).
//
// SQLite ONLY: this ignores `TEST_DATABASE_TYPE`, so a suite built on it passes
// under the pg environment variables having never talked to PostgreSQL. Reach
// for `getTestDatabaseWithInstance` when the SQL under test must agree on both
// backends.
export const getTestSQLDatabaseWithInstance = () => {
  const instance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  const database = withSchemaDumpMigrate(
    getSQLDatabase(instance),
    instance,
    applySqliteSchema
  )
  return { database, instance }
}

// SQLite ONLY — see the note on `getTestSQLDatabaseWithInstance`.
export const getTestSQLDatabase = () =>
  getTestSQLDatabaseWithInstance().database
