import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds private bookmark folders: `bookmark_folders` holds an actor's folders,
// and the nullable `bookmarks.folderId` files a bookmark into at most one of
// them (null is unfiled). Folders are never federated. The folder column has
// no foreign key, like the rest of `bookmarks`: deleting a folder unfiles its
// bookmarks in the same transaction instead (bookmark/queries.ts), and a key
// would also stop SQLite dropping the column in `down`.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('bookmark_folders')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) =>
      col.notNull().references('actors.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addUniqueConstraint('bookmark_folders_actor_name_unique', [
      'actorId',
      'name'
    ])
    .execute()

  await db.schema
    .createIndex('bookmark_folders_actor_created')
    .ifNotExists()
    .on('bookmark_folders')
    .columns(['actorId', 'createdAt'])
    .execute()

  await db.schema
    .alterTable('bookmarks')
    .addColumn('folderId', 'varchar(255)')
    .execute()

  await db.schema
    .createIndex('bookmarks_actor_folder_created_id')
    .ifNotExists()
    .on('bookmarks')
    .columns(['actorId', 'folderId', 'createdAt', 'id'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('bookmarks_actor_folder_created_id')
    .ifExists()
    .execute()
  await db.schema.alterTable('bookmarks').dropColumn('folderId').execute()
  await db.schema
    .dropIndex('bookmark_folders_actor_created')
    .ifExists()
    .execute()
  await db.schema.dropTable('bookmark_folders').ifExists().execute()
}
