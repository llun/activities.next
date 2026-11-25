import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Cross-posting a local post to Bluesky (lib/services/bluesky/):
// - `bluesky_crossposts`: one row per local status that is being (or was)
//   posted to Bluesky. `state` is 'pending' while a job holds the claim,
//   'posting' while one attempt owns the upload (its token in `attemptId`),
//   'posted' once the record exists (with its AT-URI and CID) and 'failed'
//   with the reason. The unique `uri` keeps one Bluesky record per row.
// - `bluesky_accounts.crosspostByDefault`: whether new posts are cross-posted
//   without asking each time.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('bluesky_crossposts')
    .ifNotExists()
    .addColumn('statusId', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('uri', 'varchar(512)', (col) => col.unique())
    .addColumn('cid', 'varchar(255)')
    .addColumn('state', 'varchar(16)', (col) => col.notNull())
    .addColumn('attemptId', 'varchar(64)')
    .addColumn('error', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('bluesky_crossposts_actor_idx')
    .ifNotExists()
    .on('bluesky_crossposts')
    .column('actorId')
    .execute()

  const accountColumns = (await db.introspection.getTables())
    .find((candidate) => candidate.name === 'bluesky_accounts')
    ?.columns.map((column) => column.name)
  if (!accountColumns?.includes('crosspostByDefault')) {
    await db.schema
      .alterTable('bluesky_accounts')
      .addColumn('crosspostByDefault', 'boolean', (col) =>
        col.notNull().defaultTo(true)
      )
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropIndex('bluesky_crossposts_actor_idx').ifExists().execute()
  await db.schema.dropTable('bluesky_crossposts').ifExists().execute()
  await db.schema
    .alterTable('bluesky_accounts')
    .dropColumn('crosspostByDefault')
    .execute()
}
