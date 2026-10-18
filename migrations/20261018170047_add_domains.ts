import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `domains`: the domains an admin added in Admin › Domains, each with its
// own on/off status, sign-up settings and the result of the last reachability
// check. Active rows join the primary host and the concrete
// ACTIVITIES_TRUSTED_HOSTS entries as domains this server serves. A concrete
// trusted host may also get a row, to hold its sign-up settings only; its
// status is never read. Per-domain identity overrides (step 4 of the
// multi-domain plan) add nullable columns to this row.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('domains')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('domain', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('off'))
    .addColumn('name', 'varchar(255)')
    .addColumn('signupsOpen', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('allowedEmails', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('allowExistingUsers', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('lastCheckedAt', timestampType)
    .addColumn('lastCheckStatus', 'varchar(16)')
    .addColumn('lastCheckResult', 'text')
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('domains_status_idx')
    .ifNotExists()
    .on('domains')
    .column('status')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropTable('domains').ifExists().execute()
}
