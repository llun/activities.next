import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Bluesky accounts and posts as rows of their own (lib/services/bluesky/):
// - `actors.network` and `statuses.network`: 'bluesky' for a row read from
//   Bluesky, NULL for everything else (ActivityPub). Nullable, so adding it
//   rewrites neither table. Their ids are https://bsky.app/profile/<did> and
//   …/post/<rkey>; ActivityPub fetching and delivery refuse those.
// - `bluesky_records`: the at:// URI and cid of each Bluesky post row.
// - `bluesky_follows`: a follow an actor made on Bluesky (its record URI),
//   kept apart from ActivityPub `follows`.
// - `bluesky_accounts.lastSyncedAt` / `syncError`: when the Home sync last
//   finished, and why the last one failed (shown in Settings).

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  for (const table of ['actors', 'statuses']) {
    const columns = await db.introspection.getTables()
    const exists = columns
      .find((candidate) => candidate.name === table)
      ?.columns.some((column) => column.name === 'network')
    if (!exists) {
      await db.schema
        .alterTable(table)
        .addColumn('network', 'varchar(16)')
        .execute()
    }
  }

  await db.schema
    .createTable('bluesky_records')
    .ifNotExists()
    .addColumn('statusId', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('uri', 'varchar(512)', (col) => col.notNull().unique())
    .addColumn('cid', 'varchar(255)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createTable('bluesky_follows')
    .ifNotExists()
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('targetActorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('uri', 'varchar(512)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('bluesky_follows_pkey', [
      'actorId',
      'targetActorId'
    ])
    .execute()

  await db.schema
    .createIndex('bluesky_follows_target_idx')
    .ifNotExists()
    .on('bluesky_follows')
    .column('targetActorId')
    .execute()

  const accountColumns = (await db.introspection.getTables())
    .find((candidate) => candidate.name === 'bluesky_accounts')
    ?.columns.map((column) => column.name)
  if (!accountColumns?.includes('lastSyncedAt')) {
    await db.schema
      .alterTable('bluesky_accounts')
      .addColumn('lastSyncedAt', timestampType)
      .execute()
  }
  if (!accountColumns?.includes('syncError')) {
    await db.schema
      .alterTable('bluesky_accounts')
      .addColumn('syncError', 'text')
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .alterTable('bluesky_accounts')
    .dropColumn('syncError')
    .execute()
  await db.schema
    .alterTable('bluesky_accounts')
    .dropColumn('lastSyncedAt')
    .execute()
  await db.schema.dropIndex('bluesky_follows_target_idx').ifExists().execute()
  await db.schema.dropTable('bluesky_follows').ifExists().execute()
  await db.schema.dropTable('bluesky_records').ifExists().execute()
  await db.schema.alterTable('statuses').dropColumn('network').execute()
  await db.schema.alterTable('actors').dropColumn('network').execute()
}
