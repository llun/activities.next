import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds the tables behind linking a Bluesky account to an actor
// (lib/services/bluesky/):
// - `bluesky_accounts`: one linked account per actor, and one actor per DID.
//   `instanceHandle` is the server host an actor answers
//   `/.well-known/atproto-did` for; unique, so only one actor holds a host.
// - `bluesky_sessions`: the encrypted OAuth or app-password session, keyed by
//   DID because the atproto OAuth client stores it by DID before the callback
//   knows which actor asked.
// - `bluesky_oauth_states`: encrypted pending authorization requests, which
//   expire after `expiresAt`.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('bluesky_accounts')
    .ifNotExists()
    .addColumn('actorId', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('did', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('handle', 'varchar(255)', (col) => col.notNull())
    .addColumn('pdsUrl', 'varchar(2048)', (col) => col.notNull())
    .addColumn('authType', 'varchar(16)', (col) => col.notNull())
    .addColumn('domainHandle', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('instanceHandle', 'varchar(255)', (col) => col.unique())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createTable('bluesky_sessions')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('session', 'text', (col) => col.notNull())
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createTable('bluesky_oauth_states')
    .ifNotExists()
    .addColumn('key', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('expiresAt', timestampType, (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('bluesky_oauth_states_expires_at_idx')
    .ifNotExists()
    .on('bluesky_oauth_states')
    .column('expiresAt')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('bluesky_oauth_states_expires_at_idx')
    .ifExists()
    .execute()
  await db.schema.dropTable('bluesky_oauth_states').ifExists().execute()
  await db.schema.dropTable('bluesky_sessions').ifExists().execute()
  await db.schema.dropTable('bluesky_accounts').ifExists().execute()
}
