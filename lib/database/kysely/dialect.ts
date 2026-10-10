import { type SelectQueryBuilder, SqliteAdapter, sql } from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import type { EpochMs } from '@/lib/database/kysely/db'

// The single place for SQL that differs between the backends the Kysely layer
// supports. Domain queries call these helpers instead of branching on the
// dialect themselves.

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

// The text at property `key` of the JSON object in `column` (a qualified
// column name), NULL when either is missing: `->>` on PostgreSQL,
// json_extract() on SQLite. `key` is spliced into the SQL as a literal, so it
// must be a plain property name, never user input.
export const jsonText = (db: Db, column: string, key: string) =>
  getDialectName(db) === 'sqlite'
    ? sql<
        string | null
      >`json_extract(${sql.ref(column)}, ${sql.lit(`$.${key}`)})`
    : sql<string | null>`${sql.ref(column)}::jsonb ->> ${sql.lit(key)}`

// Keeps the `search_documents` rows whose documentText contains every token as
// a word prefix. `query` must select from `search_documents` and `tokens` must
// be non-empty and made of letters, digits and underscores (getSearchTokens()
// guarantees both): they are written into the match syntax, not escaped.
//
// SQLite matches through the FTS5 table search_documents_fts, joined on its
// rowid. PostgreSQL matches the same to_tsvector('simple', "documentText")
// expression its GIN index is built on, so the index is used.
export const fullTextMatch = <TB extends keyof DB, O>(
  db: Db,
  query: SelectQueryBuilder<DB, TB, O>,
  tokens: string[]
) => {
  const isSqlite = getDialectName(db) === 'sqlite'
  const ftsQuery = tokens.map((token) => `${token}*`).join(' ')
  const tsQuery = tokens.map((token) => `${token}:*`).join(' & ')
  return query
    .$if(isSqlite, (qb) =>
      qb
        .innerJoin('search_documents_fts', (join) =>
          join.on(
            sql<boolean>`search_documents_fts.rowid = search_documents.rowid`
          )
        )
        .where(sql<boolean>`search_documents_fts match ${ftsQuery}`)
    )
    .$if(!isSqlite, (qb) =>
      qb.where(
        sql<boolean>`to_tsvector('simple', ${sql.ref('documentText')}) @@ to_tsquery('simple', ${tsQuery})`
      )
    )
}
