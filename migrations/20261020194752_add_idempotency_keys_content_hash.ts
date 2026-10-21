import type { Kysely } from 'kysely'

// Adds two columns to `idempotency_keys`:
// - `contentHash`: the SHA-256 hex digest of the normalized POST
//   /api/v1/statuses request body that claimed the key. A retry with the same
//   (actorId, key) and a different contentHash is rejected with 422 instead of
//   returning a status created from different parameters. Null on keys written
//   before this migration: readers accept null as matching any body.
// - `state`: how far the create that claimed the key got. 'pending' while it
//   runs, 'publishing' while a request waits for the queue to take its
//   federation job, 'publish_failed' when the queue refused it, 'complete' once
//   the queue accepted it. Rows written before this migration, and keys saved
//   by anything other than a status create, default to 'complete'.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const columns =
    tables.find((table) => table.name === 'idempotency_keys')?.columns ?? []
  const hasColumn = (name: string) =>
    columns.some((column) => column.name === name)
  if (!hasColumn('contentHash')) {
    await db.schema
      .alterTable('idempotency_keys')
      .addColumn('contentHash', 'varchar(64)')
      .execute()
  }
  if (!hasColumn('state')) {
    await db.schema
      .alterTable('idempotency_keys')
      .addColumn('state', 'varchar(16)', (col) =>
        col.notNull().defaultTo('complete')
      )
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.alterTable('idempotency_keys').dropColumn('state').execute()
  await db.schema
    .alterTable('idempotency_keys')
    .dropColumn('contentHash')
    .execute()
}
