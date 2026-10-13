import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler
} from 'kysely'

import type { DB } from '@/lib/database/kysely/db'
import type { TestDatabaseBackend } from '@/lib/database/testing/createTestDatabase'

/**
 * A Kysely instance that only compiles: it uses `backend`'s query compiler
 * and adapter (so `getDialectName()` and the dialect helpers answer for it),
 * but its driver never opens a connection and runs nothing. For a test that
 * asserts the SQL a builder compiles to on a backend the suite is not running
 * against, e.g. `db.selectFrom('statuses')...compile()` for PostgreSQL on a
 * SQLite run. Nothing needs destroying.
 */
export const createCompileOnlyDb = (backend: TestDatabaseBackend) =>
  new Kysely<DB>({
    dialect:
      backend === 'sqlite'
        ? {
            createAdapter: () => new SqliteAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new SqliteIntrospector(db),
            createQueryCompiler: () => new SqliteQueryCompiler()
          }
        : {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler()
          }
  })
