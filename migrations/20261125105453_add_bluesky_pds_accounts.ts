import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds the identity and lifecycle columns behind hosted Bluesky accounts
// (D2.3a):
// - `pds_repos.handle`: the account's current atproto handle, stored
//   lowercase, or null while it has none. `pds_repos_handle_live_unique` keeps
//   it unique among live repos; a tombstone keeps its handle, which a new
//   account may take again.
// - `pds_repos.recoveryKeyDid`: the `did:key` an operator added as the first
//   rotation key, or null.
// - `pds_repos.plcOperation`: the latest signed `did:plc` operation as JSON, so
//   the next update can chain `prev` without a directory round trip.
// - `pds_repos.status` also accepts 'deleted': the tombstone row a deleted
//   account keeps until retention removes it.
// - `pds_preferences`: per-DID JSON preferences for the app features that land
//   in D2.3b–d.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  const tables = await db.introspection.getTables()
  const repoColumns =
    tables.find((table) => table.name === 'pds_repos')?.columns ?? []
  const hasRepoColumn = (name: string) =>
    repoColumns.some((column) => column.name === name)

  if (!hasRepoColumn('handle')) {
    await db.schema
      .alterTable('pds_repos')
      .addColumn('handle', 'varchar(253)')
      .execute()
  }
  if (!hasRepoColumn('recoveryKeyDid')) {
    await db.schema
      .alterTable('pds_repos')
      .addColumn('recoveryKeyDid', 'varchar(255)')
      .execute()
  }
  if (!hasRepoColumn('plcOperation')) {
    await db.schema
      .alterTable('pds_repos')
      .addColumn('plcOperation', 'text')
      .execute()
  }

  await db.schema
    .createIndex('pds_repos_handle_live_unique')
    .ifNotExists()
    .on('pds_repos')
    .column('handle')
    .unique()
    .where(sql.ref('status'), '<>', 'deleted')
    .where('handle', 'is not', null)
    .execute()

  await db.schema
    .createTable('pds_preferences')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('preferences', 'text', (col) => col.notNull())
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('pds_preferences').ifExists().execute()
  await db.schema.dropIndex('pds_repos_handle_live_unique').ifExists().execute()

  const tables = await db.introspection.getTables()
  const repoColumns =
    tables.find((table) => table.name === 'pds_repos')?.columns ?? []
  const hasRepoColumn = (name: string) =>
    repoColumns.some((column) => column.name === name)

  if (hasRepoColumn('plcOperation')) {
    await db.schema.alterTable('pds_repos').dropColumn('plcOperation').execute()
  }
  if (hasRepoColumn('recoveryKeyDid')) {
    await db.schema
      .alterTable('pds_repos')
      .dropColumn('recoveryKeyDid')
      .execute()
  }
  if (hasRepoColumn('handle')) {
    await db.schema.alterTable('pds_repos').dropColumn('handle').execute()
  }
}
