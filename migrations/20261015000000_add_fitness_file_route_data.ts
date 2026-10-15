import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds fitness_file_route_data to cache pre-parsed route data per fitness file.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('fitness_file_route_data')
    .ifNotExists()
    .addColumn('fitnessFileId', 'varchar(255)', (col) =>
      col.primaryKey().references('fitness_files.id').onDelete('cascade')
    )
    .addColumn('actorId', 'varchar(255)', (col) =>
      col.notNull().references('actors.id').onDelete('cascade')
    )
    .addColumn('routeData', 'text', (col) => col.notNull())
    .addColumn('sourceVersion', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('fitness_file_route_data_actor_id_idx')
    .ifNotExists()
    .on('fitness_file_route_data')
    .column('actorId')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('fitness_file_route_data').ifExists().execute()
}
