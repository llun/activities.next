import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `bulk_imports` and `bulk_import_rows` tables for Mastodon-style CSV
// bulk imports (following, blocking, muting, domain_blocking, bookmarks, lists).

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('bulk_imports')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(255)', (col) => col.notNull())
    .addColumn('overwrite', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('state', 'varchar(255)', (col) => col.notNull())
    .addColumn('originalFilename', 'varchar(255)', (col) =>
      col.notNull().defaultTo('')
    )
    .addColumn('totalItems', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('processedItems', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('importedItems', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('overwriteDone', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('nextRowIndex', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('overwriteProgress', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('listsPrepared', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('runToken', 'varchar(255)')
    .addColumn('claimedUntil', timestampType)
    .addColumn('lastError', 'text')
    .addColumn('finishedAt', timestampType)
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('bulk_imports_actor_created_idx')
    .ifNotExists()
    .on('bulk_imports')
    .columns(['actorId', 'createdAt'])
    .execute()

  await db.schema
    .createIndex('bulk_imports_actor_state_idx')
    .ifNotExists()
    .on('bulk_imports')
    .columns(['actorId', 'state'])
    .execute()

  await db.schema
    .createTable('bulk_import_rows')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('importId', 'varchar(255)', (col) => col.notNull())
    .addColumn('rowIndex', 'integer', (col) => col.notNull())
    .addColumn('data', 'text', (col) => col.notNull())
    .addColumn('state', 'varchar(255)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('error', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('bulk_import_rows_import_row_unique')
    .ifNotExists()
    .unique()
    .on('bulk_import_rows')
    .columns(['importId', 'rowIndex'])
    .execute()

  await db.schema
    .createIndex('bulk_import_rows_import_state_idx')
    .ifNotExists()
    .on('bulk_import_rows')
    .columns(['importId', 'state'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('bulk_import_rows').ifExists().execute()
  await db.schema.dropTable('bulk_imports').ifExists().execute()
}
