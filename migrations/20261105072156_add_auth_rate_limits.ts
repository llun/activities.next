import type { Kysely } from 'kysely'

// Adds better-auth's `rateLimit` table so auth rate-limit counters
// (`storage: 'database'`) are shared across server instances/processes and
// survive restarts. `lastRequest` stores epoch milliseconds (`bigint`), `key`
// carries a unique index for per-request lookups and atomic increments, and
// `lastRequest` is indexed for better-auth's expired-row pruning.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .createTable('rateLimit')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.notNull().primaryKey())
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('count', 'integer', (col) => col.notNull())
    .addColumn('lastRequest', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('rate_limit_key_unique')
    .ifNotExists()
    .unique()
    .on('rateLimit')
    .column('key')
    .execute()

  await db.schema
    .createIndex('rate_limit_last_request_idx')
    .ifNotExists()
    .on('rateLimit')
    .column('lastRequest')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropIndex('rate_limit_last_request_idx').ifExists().execute()
  await db.schema.dropIndex('rate_limit_key_unique').ifExists().execute()
  await db.schema.dropTable('rateLimit').ifExists().execute()
}
