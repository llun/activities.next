import { type Kysely, SqliteAdapter } from 'kysely'

// Adds `stateChangedAt` to `idempotency_keys`: when a request last moved the
// key out of 'pending' (to 'publishing', 'publish_failed' or 'complete'). A
// 'publishing' key whose request stopped before the queue answered is taken
// over by a retry once this is IDEMPOTENCY_PENDING_STALE_MS old. Null while
// the key is still 'pending' and on keys written before this migration.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const columns =
    tables.find((table) => table.name === 'idempotency_keys')?.columns ?? []
  if (columns.some((column) => column.name === 'stateChangedAt')) return
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  await db.schema
    .alterTable('idempotency_keys')
    .addColumn('stateChangedAt', isSqlite ? 'datetime' : 'timestamptz')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .alterTable('idempotency_keys')
    .dropColumn('stateChangedAt')
    .execute()
}
