import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `deleted_attachment_media`: short-lived (7-day) mapping from a deleted
// status's attachment UUID (`attachmentId`) back to the underlying `medias.id`
// (`mediaId`) for its author (`actorId`), so Mastodon delete-and-redraft
// (`DELETE /api/v1/statuses/:id` followed by `POST /api/v1/statuses` with the
// deleted status's `media_attachments[].id` values) resolves the surviving
// media rows.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('deleted_attachment_media')
    .ifNotExists()
    .addColumn('attachmentId', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('mediaId', 'integer', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('deleted_attachment_media_createdAt_idx')
    .ifNotExists()
    .on('deleted_attachment_media')
    .column('createdAt')
    .execute()

  await db.schema
    .createIndex('deleted_attachment_media_actorId_idx')
    .ifNotExists()
    .on('deleted_attachment_media')
    .column('actorId')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('deleted_attachment_media_actorId_idx')
    .ifExists()
    .execute()
  await db.schema
    .dropIndex('deleted_attachment_media_createdAt_idx')
    .ifExists()
    .execute()
  await db.schema.dropTable('deleted_attachment_media').ifExists().execute()
}
