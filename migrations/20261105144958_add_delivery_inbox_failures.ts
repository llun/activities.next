import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `delivery_inbox_failures`: per-inbox outbound ActivityPub delivery
// health state. Counts distinct UTC days (`lastFailureDay`, `YYYY-MM-DD`) on
// which salvageable delivery failures occurred without an intervening success,
// and marks the inbox unavailable (`unavailableSince`) once the threshold is
// reached so outbound fan-outs and queued deliveries skip dead servers until a
// 2xx delivery or verified inbound request clears the row.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('delivery_inbox_failures')
    .ifNotExists()
    .addColumn('inbox', 'text', (col) => col.primaryKey())
    .addColumn('domain', 'text', (col) => col.notNull())
    .addColumn('failureDays', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lastFailureDay', 'text')
    .addColumn('firstFailureAt', timestampType, (col) => col.notNull())
    .addColumn('lastFailureAt', timestampType, (col) => col.notNull())
    .addColumn('unavailableSince', timestampType)
    .addColumn('lastError', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('delivery_inbox_failures_domain_idx')
    .on('delivery_inbox_failures')
    .column('domain')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('delivery_inbox_failures').ifExists().execute()
}
