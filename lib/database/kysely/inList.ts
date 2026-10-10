import type { Db } from '@/lib/database/kysely'
import { getDialectName } from '@/lib/database/kysely/dialect'
import { SQLITE_MAX_BINDINGS, chunkArray } from '@/lib/database/sql/utils/knex'

// Statements with a variable number of bound values (`where x in (…)`,
// multi-row inserts) have to be split on SQLite, which caps the bindings of one
// statement at SQLITE_MAX_BINDINGS. These are the Kysely counterparts of
// getWhereInBatchSize / getInsertBatchSize / chunkArray in
// lib/database/sql/utils/knex.ts and return the same sizes for the same
// backend (inList.test.ts compares them).

const DEFAULT_BATCH_SIZE = 1000

/** Values one `in (…)` list may hold: all of SQLite's bindings, less `reservedBindings`; 1000 on PostgreSQL. */
export const getWhereInBatchSize = (
  db: Db,
  reservedBindings = 0,
  defaultBatchSize = DEFAULT_BATCH_SIZE
) => {
  if (getDialectName(db) !== 'sqlite') return defaultBatchSize
  return Math.max(1, SQLITE_MAX_BINDINGS - reservedBindings)
}

/** Rows one multi-row insert may hold: `defaultBatchSize`, less what the column count leaves on SQLite. */
export const getInsertBatchSize = (
  db: Db,
  row: Record<string, unknown>,
  defaultBatchSize = DEFAULT_BATCH_SIZE
) => {
  const boundedDefaultBatchSize = Number.isFinite(defaultBatchSize)
    ? Math.max(1, Math.floor(defaultBatchSize))
    : DEFAULT_BATCH_SIZE

  if (getDialectName(db) !== 'sqlite') return boundedDefaultBatchSize

  const columnCount = Math.max(1, Object.keys(row).length)
  return Math.min(
    boundedDefaultBatchSize,
    Math.max(1, Math.floor(SQLITE_MAX_BINDINGS / columnCount))
  )
}

/**
 * Runs `select` once per chunk of `values`, one after the other, and returns
 * every row in chunk order. `select` puts the chunk in its `in (…)` list;
 * `reservedBindings` is how many other values the same statement binds.
 */
export const selectInChunks = async <Value, Row>(
  db: Db,
  values: Value[],
  select: (chunk: Value[]) => Promise<Row[]>,
  reservedBindings = 0
): Promise<Row[]> => {
  const rows: Row[] = []
  for (const chunk of chunkArray(
    values,
    getWhereInBatchSize(db, reservedBindings)
  )) {
    rows.push(...(await select(chunk)))
  }
  return rows
}

/**
 * Runs `insert` once per chunk of `rows`, one after the other, each chunk small
 * enough for one multi-row insert. The first row sets the column count, so all
 * rows must have the same columns.
 */
export const insertInChunks = async <Row extends Record<string, unknown>>(
  db: Db,
  rows: Row[],
  insert: (chunk: Row[]) => Promise<unknown>,
  defaultBatchSize = DEFAULT_BATCH_SIZE
): Promise<void> => {
  if (rows.length === 0) return
  for (const chunk of chunkArray(
    rows,
    getInsertBatchSize(db, rows[0], defaultBatchSize)
  )) {
    await insert(chunk)
  }
}
