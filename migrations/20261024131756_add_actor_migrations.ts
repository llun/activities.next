import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `actor_migrations`: one row per account move or redirect recorded for an
// actor, with the target account and the followers count at the time.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('actor_migrations')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('targetActorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('targetAcct', 'varchar(255)', (col) =>
      col.notNull().defaultTo('')
    )
    .addColumn('kind', 'varchar(255)', (col) => col.notNull())
    .addColumn('followersCount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    // Set once the Move job is queued: a move whose publish failed has none.
    .addColumn('startedAt', timestampType)
    .execute()

  await db.schema
    .createIndex('actor_migrations_actor_created_idx')
    .ifNotExists()
    .on('actor_migrations')
    .columns(['actorId', 'createdAt'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('actor_migrations').ifExists().execute()
}
