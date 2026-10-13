import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'

// Thin aliases over `createTestDatabase` (lib/database/testing/), kept so the
// existing suites do not change. New tests should call `createTestDatabase`
// directly and seed state with `lib/database/testing/fixtures.ts`.
export {
  getTestPgConnection,
  getTestPgPort
} from '@/lib/database/testing/postgres'

export type PrepareFunction = () => Promise<void> | void
export type TestDatabaseTableItem = [string, Database, PrepareFunction]
export type TestDatabaseTable = TestDatabaseTableItem[]

export const getTestDatabaseTable = (): TestDatabaseTable => {
  const { backend, database, prepare } = createTestDatabase()
  return [[backend, database, prepare]]
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

// What `getTestDatabaseWithInstance` and `getTestSQLDatabaseWithInstance` hand
// out besides `database`: Kysely on the same pool for seeding and reading, and
// statement capture. `db` stays a getter, as on `TestDatabase`,
// so a suite built around a mocked Knex never builds a Kysely instance. Hand
// them out with a getter, not a spread, which would read `db` eagerly.
export type TestDatabaseTools = Pick<
  TestDatabase,
  'db' | 'captureQueries' | 'onQuery' | 'pendingAcquires'
>

/**
 * A database honouring `TEST_DATABASE_TYPE`, plus a Kysely `db` on the same
 * pool, statement capture (`captureQueries`, `onQuery`) and the `prepare` step
 * PostgreSQL needs, for a suite that is not
 * shaped as a `describe.each` over `getTestDatabaseTable()` but still has to
 * run on both backends.
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
): {
  database: Database
  prepare: PrepareFunction
} & TestDatabaseTools => {
  const testDatabase = createTestDatabase({
    backend: backend === 'pg' ? 'pg' : 'sqlite',
    isolated
  })
  return {
    database: testDatabase.database,
    prepare: testDatabase.prepare,
    get db() {
      return testDatabase.db
    },
    captureQueries: testDatabase.captureQueries,
    onQuery: testDatabase.onQuery,
    pendingAcquires: testDatabase.pendingAcquires
  }
}

// Build a fresh in-memory SQLite database and also hand back a Kysely `db`,
// for the rare test that needs to seed a state the public Database interface
// cannot construct (e.g. a registration-pending account row with a
// null approvedAt).
//
// SQLite ONLY: this ignores `TEST_DATABASE_TYPE`, so a suite built on it passes
// under the pg environment variables having never talked to PostgreSQL. Reach
// for `getTestDatabaseWithInstance` when the SQL under test must agree on both
// backends.
export const getTestSQLDatabaseWithInstance = (): {
  database: Database
} & TestDatabaseTools => {
  const testDatabase = createTestDatabase({ backend: 'sqlite' })
  return {
    database: testDatabase.database,
    get db() {
      return testDatabase.db
    },
    captureQueries: testDatabase.captureQueries,
    onQuery: testDatabase.onQuery,
    pendingAcquires: testDatabase.pendingAcquires
  }
}

// SQLite ONLY — see the note on `getTestSQLDatabaseWithInstance`.
export const getTestSQLDatabase = () =>
  getTestSQLDatabaseWithInstance().database
