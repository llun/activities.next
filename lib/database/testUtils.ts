import type { Knex } from 'knex'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
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
): {
  database: Database
  instance: Knex
  prepare: PrepareFunction
} => {
  const { database, knex, prepare } = createTestDatabase({
    backend: backend === 'pg' ? 'pg' : 'sqlite',
    isolated
  })
  return { database, instance: knex, prepare }
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
  const { database, knex } = createTestDatabase({ backend: 'sqlite' })
  return { database, instance: knex }
}

// SQLite ONLY — see the note on `getTestSQLDatabaseWithInstance`.
export const getTestSQLDatabase = () =>
  getTestSQLDatabaseWithInstance().database
