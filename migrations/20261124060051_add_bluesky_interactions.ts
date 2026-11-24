import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Bluesky interactions and notification polling state:
// - `bluesky_interactions`: likes and reposts an actor made on Bluesky (with
//   their AT-URI so they can be undone), kept apart from ActivityPub likes/boosts.
// - `bluesky_accounts.notificationsSeenAt`: when Bluesky notifications were
//   last polled/seen for the linked account.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('bluesky_interactions')
    .ifNotExists()
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('statusId', 'varchar(255)', (col) => col.notNull())
    .addColumn('kind', 'varchar(16)', (col) => col.notNull())
    .addColumn('uri', 'varchar(512)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('bluesky_interactions_pkey', [
      'actorId',
      'statusId',
      'kind'
    ])
    .execute()

  await db.schema
    .createIndex('bluesky_interactions_status_idx')
    .ifNotExists()
    .on('bluesky_interactions')
    .column('statusId')
    .execute()

  const accountColumns = (await db.introspection.getTables())
    .find((candidate) => candidate.name === 'bluesky_accounts')
    ?.columns.map((column) => column.name)
  if (!accountColumns?.includes('notificationsSeenAt')) {
    await db.schema
      .alterTable('bluesky_accounts')
      .addColumn('notificationsSeenAt', timestampType)
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .alterTable('bluesky_accounts')
    .dropColumn('notificationsSeenAt')
    .execute()
  await db.schema
    .dropIndex('bluesky_interactions_status_idx')
    .ifExists()
    .execute()
  await db.schema.dropTable('bluesky_interactions').ifExists().execute()
}
