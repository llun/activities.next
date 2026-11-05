import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `fitness_best_efforts`: one row per fitness file per effort, the best
// average power over a duration (`kind` 'power', `key` seconds, `value` watts)
// or a run's fastest time over a distance (`kind` 'distance', `key` metres,
// `value` seconds). The processor rewrites a file's rows on every run, and the
// Records page reads the best per (actorId, kind, key) since a date, which is
// what the index is for.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('fitness_best_efforts')
    .ifNotExists()
    .addColumn('fitnessFileId', 'varchar(255)', (col) =>
      col.notNull().references('fitness_files.id').onDelete('cascade')
    )
    .addColumn('actorId', 'varchar(255)', (col) =>
      col.notNull().references('actors.id').onDelete('cascade')
    )
    .addColumn('statusId', 'varchar(255)', (col) => col.notNull())
    .addColumn('activityType', 'varchar(255)')
    .addColumn('kind', 'varchar(16)', (col) => col.notNull())
    .addColumn('key', sql`float`, (col) => col.notNull())
    .addColumn('value', sql`float`, (col) => col.notNull())
    .addColumn('activityDate', timestampType, (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('fitness_best_efforts_pkey', [
      'fitnessFileId',
      'kind',
      'key'
    ])
    .execute()

  await db.schema
    .createIndex('fitness_best_efforts_actor_kind_key_date_idx')
    .ifNotExists()
    .on('fitness_best_efforts')
    .columns(['actorId', 'kind', 'key', 'activityDate'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('fitness_best_efforts').ifExists().execute()
}
