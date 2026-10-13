import knexFactory, { type Knex } from 'knex'

import {
  type TestDatabaseBackend,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import { getTestPgConnection } from '@/lib/database/testing/postgres'

/**
 * LEGACY: a Knex instance for the legacy migration tests, which run a Knex
 * migration module (`up(knex)` / `down(knex)`) against tables they build or a
 * schema `createTestDatabase` loaded. Nothing else uses Knex; this goes away
 * with the Knex migrations.
 *
 * - SQLite: a fresh in-memory database of its own. It shares nothing with a
 *   test database's `db`.
 * - PostgreSQL: the same per-worker database `createTestDatabase` uses (the
 *   `_isolated` one with `isolated`), so call that test database's `prepare()`
 *   first; Knex then sees what `db` wrote and the other way round.
 *
 * Destroy it when done.
 */
export const createLegacyKnex = (
  backend: TestDatabaseBackend,
  { isolated = false }: { isolated?: boolean } = {}
): Knex =>
  backend === 'pg'
    ? knexFactory({
        client: 'pg',
        connection: {
          ...getTestPgConnection(),
          database: getTestPgDatabaseName(isolated)
        }
      })
    : knexFactory({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
