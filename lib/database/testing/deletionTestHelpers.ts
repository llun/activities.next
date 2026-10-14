import { sql } from 'kysely'

import type { TestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { CapturedQuery } from '@/lib/database/testing/queryCapture'

// Shared by the status and actor deletion query tests
// (statusDeletionQueries.test.ts, actorDeletionQueries.test.ts): a dump of
// every table, triggers that make one write fail, the statements a call sends
// and the PostgreSQL lock-wait probe.

export type TableDump = Record<string, Record<string, unknown>[]>

// The migration runners' bookkeeping: Kysely's, in the schema dumps since the
// Knex handover, and Knex's.
const MIGRATION_BOOKKEEPING = /^(kysely_migration|knex_migrations)/

const tableNames = async (testDb: TestDatabase): Promise<string[]> => {
  if (testDb.backend === 'pg') {
    const { rows } = await sql<{ name: string }>`
      select table_name as name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `.execute(testDb.db)
    return rows.map((row) => row.name).sort()
  }
  const { rows } = await sql<{ name: string }>`
    select name from sqlite_master where type = 'table'
  `.execute(testDb.db)
  return rows
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') && !name.startsWith('search_documents_fts')
    )
    .sort()
}

const rowKey = (row: Record<string, unknown>) =>
  JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))

/**
 * Every row of every table (but the migration bookkeeping, SQLite's FTS
 * shadow tables and `skipped`), each table's rows in a stable order.
 */
export const dumpDatabase = async (
  testDb: TestDatabase,
  skipped: string[] = []
): Promise<TableDump> => {
  const dump: TableDump = {}
  for (const name of await tableNames(testDb)) {
    if (MIGRATION_BOOKKEEPING.test(name) || skipped.includes(name)) continue
    const { rows } = await sql<Record<string, unknown>>`
      select * from ${sql.table(name)}
    `.execute(testDb.db)
    dump[name] = [...rows].sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
  }
  return dump
}

/** `dump` with `table`'s rows replaced by `change(rows)`, kept sorted. */
export const withTable = (
  dump: TableDump,
  table: string,
  change: (rows: Record<string, unknown>[]) => Record<string, unknown>[]
): TableDump => ({
  ...dump,
  [table]: change(dump[table].map((row) => ({ ...row }))).sort((a, b) =>
    rowKey(a).localeCompare(rowKey(b))
  )
})

/**
 * Makes every `event` on `table` whose row matches `condition` (SQL over
 * `new` for an insert or update and `old` for a delete, valid on both
 * backends) fail with "forced failure". Returns the function that removes the
 * trigger again.
 */
let triggerCount = 0
export const failWrite = async (
  testDb: TestDatabase,
  table: string,
  event: 'insert' | 'update' | 'delete',
  condition: string
) => {
  triggerCount += 1
  const name = `deletion_fail_${triggerCount}`
  const db = testDb.db
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db)
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${condition}) execute function ${name}()`
      )
      .execute(db)
    return async () => {
      await sql.raw(`drop trigger ${name} on "${table}"`).execute(db)
      await sql.raw(`drop function ${name}()`).execute(db)
    }
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db)
  return async () => {
    await sql.raw(`drop trigger ${name}`).execute(db)
  }
}

export const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

export type Statement = CapturedQuery

/** The statements `run` sends, with what it returned. */
export const capture = async <T>(
  testDb: TestDatabase,
  run: () => Promise<T>
) => {
  let result!: T
  const statements = await testDb.captureQueries(async () => {
    result = await run()
  })
  return { result, statements }
}

export type StatementNames = [RegExp, (bindings: unknown[]) => string][]

/** `statement` named by the first pattern of `names` it matches. */
export const describeStatement = (
  names: StatementNames,
  { sql: text, bindings }: Statement
) => {
  for (const [pattern, name] of names) {
    if (pattern.test(text)) return name(bindings)
  }
  return `unknown: ${text}`
}

// Runs `operation` without awaiting it, recording when it settles, so a test
// can tell an operation that waited for a lock from one that never needed to.
export const start = <T>(operation: () => Promise<T>) => {
  const state = { settled: false }
  const outcome = operation().then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error })
  )
  void outcome.finally(() => {
    state.settled = true
  })
  return {
    state,
    result: async () => {
      const { value, error } = await outcome
      if (error !== undefined) throw error
      return value as T
    }
  }
}

/**
 * Resolves with the statements of the backends of this database that wait on
 * a lock, once there is one; fails as soon as `waiter` settles instead, or
 * after five seconds. pg_stat_activity is read a second time once a backend
 * waits, since its `query` can lag the wait event.
 */
export const waitForLockWait = async (
  testDb: TestDatabase,
  waiter: { state: { settled: boolean } }
): Promise<string[]> => {
  const waiting = async () =>
    (
      await sql<{ query: string }>`
        select query from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'
      `.execute(testDb.db)
    ).rows.map((row) => row.query)
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (waiter.state.settled) {
      throw new Error('the operation finished without waiting for a row lock')
    }
    if ((await waiting()).length > 0) return waiting()
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('no backend ever waited for a row lock')
}
