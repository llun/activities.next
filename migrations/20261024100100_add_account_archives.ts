import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds account_archives: one row per user-requested account export (the zip a
// signed-in owner downloads from Account > Import and export).
//
// - `status`: queued | running | ready | failed | expired.
// - `options` and `progress` are JSON text. `progress` is the resumable cursor
//   ExportAccountArchiveJob persists between time-budgeted slices.
// - `storagePath` is the object key of the finished zip (under `archives/`),
//   `bytes` its size, `expiresAt` when the file is deleted (7 days after it was
//   ready).
// - `storageToken` is a random segment of every object key of the export
//   (`archives/<id>/<token>/...`). It never leaves the server: a bucket served
//   from a public hostname must not make the files guessable from the id.
// - `heartbeatAt` is when the export last moved (created, a cursor saved, a
//   stuck export requeued); `reapCount` how often it was requeued as stuck.
// - The partial unique index allows one queued or running export per account,
//   so two concurrent requests cannot both start one.
//
// The account FK cascades, so deleting an account removes its export rows.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('account_archives')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('accountId', 'varchar(255)', (col) =>
      col.notNull().references('accounts.id').onDelete('cascade')
    )
    .addColumn('status', 'varchar(32)', (col) =>
      col.notNull().defaultTo('queued')
    )
    .addColumn('options', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('storageToken', 'varchar(64)', (col) => col.notNull())
    .addColumn('progress', 'text')
    .addColumn('storagePath', 'varchar(512)')
    .addColumn('bytes', 'bigint')
    .addColumn('error', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('heartbeatAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('reapCount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('readyAt', timestampType)
    .addColumn('expiresAt', timestampType)
    .execute()

  await db.schema
    .createIndex('account_archives_account_created_idx')
    .ifNotExists()
    .on('account_archives')
    .columns(['accountId', 'createdAt'])
    .execute()

  await db.schema
    .createIndex('account_archives_account_active_idx')
    .ifNotExists()
    .unique()
    .on('account_archives')
    .column('accountId')
    .where(sql.ref('status'), 'in', [sql.lit('queued'), sql.lit('running')])
    .execute()

  await db.schema
    .createIndex('account_archives_heartbeat_idx')
    .ifNotExists()
    .on('account_archives')
    .columns(['status', 'heartbeatAt'])
    .execute()

  await db.schema
    .createIndex('account_archives_expires_idx')
    .ifNotExists()
    .on('account_archives')
    .columns(['status', 'expiresAt'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('account_archives').ifExists().execute()
}
