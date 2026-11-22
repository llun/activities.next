import {
  type Expression,
  type RawBuilder,
  type SelectQueryBuilder,
  SqliteAdapter,
  sql
} from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import type { EpochMs } from '@/lib/database/kysely/db'

// The single place for SQL that differs between the backends the Kysely layer
// supports. Domain queries call these helpers instead of branching on the
// dialect themselves.

export type DialectName = 'sqlite' | 'postgres'

export const getDialectName = (db: Db): DialectName =>
  db.getExecutor().adapter instanceof SqliteAdapter ? 'sqlite' : 'postgres'

type Lockable<QB, Of> = { forUpdate(of?: Of): QB }

// Row lock for a SELECT inside a transaction. SQLite has no row locks (a
// write transaction locks the whole database) and rejects `for update`, which
// Kysely's SQLite compiler emits anyway, so this leaves it off there. `of`
// names the tables of a join whose rows are locked (`for update of ...`);
// without it every joined table's rows are.
export const forUpdate = <
  QB extends Lockable<QB, Of>,
  Of extends string | readonly string[] = never
>(
  db: Db,
  query: QB,
  of?: Of
): QB => (getDialectName(db) === 'sqlite' ? query : query.forUpdate(of))

type ShareLockable<QB> = { forShare(): QB }

// Shared row lock for a SELECT inside a transaction: other transactions can
// still read the rows, but an update or delete of them waits until this
// transaction ends. SQLite has no row locks and rejects `for share`; it runs
// one connection, so a read inside a transaction is already atomic with the
// writes after it.
export const forShare = <QB extends ShareLockable<QB>>(
  db: Db,
  query: QB
): QB => (getDialectName(db) === 'sqlite' ? query : query.forShare())

// Compare timestamp columns only through timestampValue(). A bare number does
// not type-check, but a value read back from a timestamp column is also EpochMs
// and still type-checks, so pass it through timestampValue() too. Timestamp
// columns read back as epoch milliseconds, but each backend has to be sent a
// Date: node-postgres serialises it as a timestamptz literal (a bare number
// would be rejected), and the SQLite driver binds it as epoch milliseconds.
export const timestampValue = (value: number | Date) =>
  sql<EpochMs>`${value instanceof Date ? value : new Date(value)}`

// The text at property `key` of the JSON object in `column` (a qualified
// column name), NULL when either is missing: `->>` on PostgreSQL,
// json_extract() on SQLite. More keys follow nested objects (`'upload',
// 'state'` reads `$.upload.state`, `-> 'upload' ->> 'state'`). Each key is
// spliced into the SQL as a literal, so it must be a plain property name, never
// user input.
export const jsonText = (
  db: Db,
  column: string,
  ...path: [string, ...string[]]
) => {
  if (getDialectName(db) === 'sqlite') {
    return sql<
      string | null
    >`json_extract(${sql.ref(column)}, ${sql.lit(`$.${path.join('.')}`)})`
  }
  const objects = path.slice(0, -1).map((key) => sql` -> ${sql.lit(key)}`)
  return sql<
    string | null
  >`${sql.ref(column)}::jsonb${sql.join(objects, sql``)} ->> ${sql.lit(path[path.length - 1])}`
}

// The hashtag name in `column` (a qualified tags.nameNormalized reference)
// with its leading `#`s stripped and lowercased, so a tag stored as `name` and
// one stored as `#name` group and match as one: ltrim() on SQLite, trim(leading)
// on PostgreSQL.
export const normalizedHashtagName = (db: Db, column: string) =>
  getDialectName(db) === 'sqlite'
    ? sql<string>`lower(ltrim(${sql.ref(column)}, ${'#'}))`
    : sql<string>`lower(trim(leading '#' from ${sql.ref(column)}))`

// Extracts the year and month in UTC as a 'YYYY-MM' string: strftime() on
// SQLite (where epoch milliseconds are divided by 1000.0), to_char() at time
// zone 'UTC' on PostgreSQL.
export const utcYearMonth = (
  db: Db,
  ref: string | Expression<unknown>
): RawBuilder<string> => {
  const target = typeof ref === 'string' ? sql.ref(ref) : ref
  return getDialectName(db) === 'sqlite'
    ? sql<string>`strftime('%Y-%m', ${target} / 1000.0, 'unixepoch')`
    : sql<string>`to_char(${target} at time zone 'UTC', 'YYYY-MM')`
}

// The UTC calendar day of a timestamp column as 'YYYY-MM-DD'. SQLite's
// datetime columns hold epoch ms INTEGER (app writes) or
// 'YYYY-MM-DD HH:MM:SS' TEXT (the CURRENT_TIMESTAMP default, read as UTC like
// toEpochMilliseconds does), so the expression branches on typeof();
// PostgreSQL is one to_char().
export const utcDay = (
  db: Db,
  ref: string | Expression<unknown>
): RawBuilder<string> => {
  const target = typeof ref === 'string' ? sql.ref(ref) : ref
  return getDialectName(db) === 'sqlite'
    ? sql<string>`case when typeof(${target}) in ('integer', 'real') then strftime('%Y-%m-%d', ${target} / 1000.0, 'unixepoch') else strftime('%Y-%m-%d', ${target}) end`
    : sql<string>`to_char(${target} at time zone 'UTC', 'YYYY-MM-DD')`
}

// What a full-text match asks of a document's text: every term as a word
// prefix, every phrase as consecutive whole words, and none of the excluded
// words or phrases. Every token must be non-empty and made of letters, digits
// and underscores (getSearchTokens() guarantees it): tokens are written into
// the match syntax, not escaped, and nothing else the user typed ever is.
export type FullTextQuery = {
  terms: string[]
  phrases: string[][]
  excluded: string[][]
}

// Keeps the `search_documents` rows whose documentText matches `text`. `query`
// must select from `search_documents`, and `text` must hold at least one term,
// phrase or excluded entry; with no term or phrase it only drops the rows that
// hold an excluded one.
//
// SQLite matches through the FTS5 table search_documents_fts, joined on its
// rowid, and drops excluded rows with a second FTS5 match. PostgreSQL matches
// the same to_tsvector('simple', "documentText") expression its GIN index is
// built on, with phrases as `<->` and exclusions as `!` in one tsquery.
export const fullTextQueryMatch = <TB extends keyof DB, O>(
  db: Db,
  query: SelectQueryBuilder<DB, TB, O>,
  { terms, phrases, excluded }: FullTextQuery
) => {
  if (getDialectName(db) === 'sqlite') {
    const ftsPhrase = (tokens: string[]) => `"${tokens.join(' ')}"`
    const positive = [
      ...terms.map((token) => `${token}*`),
      ...phrases.map(ftsPhrase)
    ].join(' ')
    const negative = excluded.map(ftsPhrase).join(' OR ')
    return query
      .$if(positive.length > 0, (qb) =>
        qb
          .innerJoin('search_documents_fts', (join) =>
            join.on(
              sql<boolean>`search_documents_fts.rowid = search_documents.rowid`
            )
          )
          .where(sql<boolean>`search_documents_fts match ${positive}`)
      )
      .$if(negative.length > 0, (qb) =>
        qb.where(
          sql<boolean>`search_documents.rowid not in (select rowid from search_documents_fts where search_documents_fts match ${negative})`
        )
      )
  }

  const tsPhrase = (tokens: string[]) =>
    tokens.length === 1 ? tokens[0] : `(${tokens.join(' <-> ')})`
  const tsQuery = [
    ...terms.map((token) => `${token}:*`),
    ...phrases.map(tsPhrase),
    ...excluded.map((tokens) => `!${tsPhrase(tokens)}`)
  ].join(' & ')
  return query.where(
    sql<boolean>`to_tsvector('simple', ${sql.ref('documentText')}) @@ to_tsquery('simple', ${tsQuery})`
  )
}

// Keeps the `search_documents` rows whose documentText contains every token as
// a word prefix (see fullTextQueryMatch).
export const fullTextMatch = <TB extends keyof DB, O>(
  db: Db,
  query: SelectQueryBuilder<DB, TB, O>,
  tokens: string[]
) => fullTextQueryMatch(db, query, { terms: tokens, phrases: [], excluded: [] })
