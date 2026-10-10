import { SqliteAdapter, sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import type { EpochMs } from '@/lib/database/kysely/db'

// The single place for SQL that differs between the backends the Kysely layer
// supports. Domain queries call these helpers instead of branching on the
// dialect themselves; later ports add JSON text extraction, full-text search,
// NULLS LAST ordering and so on here.

export type DialectName = 'sqlite' | 'postgres'

export const getDialectName = (db: Db): DialectName =>
  db.getExecutor().adapter instanceof SqliteAdapter ? 'sqlite' : 'postgres'

type Lockable<QB> = { forUpdate(): QB }

// Row lock for a SELECT inside a transaction. SQLite has no row locks (a
// write transaction locks the whole database) and rejects `for update`, which
// Kysely's SQLite compiler emits anyway; Knex compiles it to nothing there, so
// this does the same.
export const forUpdate = <QB extends Lockable<QB>>(db: Db, query: QB): QB =>
  getDialectName(db) === 'sqlite' ? query : query.forUpdate()

// Compare timestamp columns only through timestampValue(). A bare number does
// not type-check, but a value read back from a timestamp column is also EpochMs
// and still type-checks, so pass it through timestampValue() too. Timestamp
// columns read back as epoch milliseconds, but each backend has to be sent a
// Date: node-postgres serialises it as a timestamptz literal (a bare number
// would be rejected), and the SQLite driver binds it as epoch milliseconds,
// the same as Knex.
export const timestampValue = (value: number | Date) =>
  sql<EpochMs>`${value instanceof Date ? value : new Date(value)}`
