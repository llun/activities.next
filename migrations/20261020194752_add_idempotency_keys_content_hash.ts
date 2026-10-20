import type { Kysely } from 'kysely'

// Adds `idempotency_keys.contentHash`: the SHA-256 hex digest of the
// normalized POST /api/v1/statuses request body that claimed the key. A retry
// with the same (actorId, key) and a different contentHash is rejected with 422
// instead of returning a status created from different parameters. Null on
// keys written before this migration: readers accept null as matching any body.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const idempotencyKeys = tables.find(
    (table) => table.name === 'idempotency_keys'
  )
  if (
    idempotencyKeys?.columns.some((column) => column.name === 'contentHash')
  ) {
    return
  }
  await db.schema
    .alterTable('idempotency_keys')
    .addColumn('contentHash', 'varchar(64)')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .alterTable('idempotency_keys')
    .dropColumn('contentHash')
    .execute()
}
