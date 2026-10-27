import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds account_imports and account_import_items: one row per archive import
// an owner starts into their current profile, and one row per source item
// tracked inside it. The run lease (`runToken`, `claimedUntil`) follows the
// bulk_imports shape; `lastErrorCode` is a reason code, never exception text.
//
// One queued or running import per actor: the partial unique index
// account_imports_actor_active_idx refuses a second one, exactly as
// account_archives_account_active_idx does for exports.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('account_imports')
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('accountId', 'varchar(255)', (col) =>
      col.notNull().references('accounts.id').onDelete('cascade')
    )
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) =>
      col.notNull().defaultTo('queued')
    )
    .addColumn('kind', 'varchar(32)')
    .addColumn('options', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('storageToken', 'varchar(64)', (col) => col.notNull())
    .addColumn('uploadedBytes', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('archiveETag', 'text')
    .addColumn('progress', 'text')
    .addColumn('phase', 'varchar(64)')
    .addColumn('cursor', 'text')
    .addColumn('runToken', 'varchar(255)')
    .addColumn('claimedUntil', timestampType)
    .addColumn('lastErrorCode', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('startedAt', timestampType)
    .addColumn('finishedAt', timestampType)
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createTable('account_import_items')
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('importId', 'varchar(255)', (col) =>
      col.notNull().references('account_imports.id').onDelete('cascade')
    )
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('kind', 'varchar(64)', (col) => col.notNull())
    .addColumn('sourceId', 'varchar(512)', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('data', 'text')
    .addColumn('state', 'varchar(16)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('reason', 'text')
    .addColumn('targetId', 'varchar(255)')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('account_imports_actor_created_idx')
    .on('account_imports')
    .columns(['actorId', 'createdAt'])
    .execute()

  await db.schema
    .createIndex('account_imports_actor_started_idx')
    .on('account_imports')
    .columns(['actorId', 'startedAt'])
    .execute()

  await db.schema
    .createIndex('account_imports_actor_active_idx')
    .unique()
    .on('account_imports')
    .column('actorId')
    .where((eb) =>
      eb.or([
        eb(sql.ref('status'), '=', sql.lit('queued')),
        eb(sql.ref('status'), '=', sql.lit('running'))
      ])
    )
    .execute()

  await db.schema
    .createIndex('account_import_items_actor_source_unique')
    .unique()
    .on('account_import_items')
    .columns(['actorId', 'kind', 'sourceId'])
    .execute()

  await db.schema
    .createIndex('account_import_items_import_state_position_idx')
    .on('account_import_items')
    .columns(['importId', 'state', 'position'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('account_import_items').ifExists().execute()
  await db.schema.dropTable('account_imports').ifExists().execute()
}
