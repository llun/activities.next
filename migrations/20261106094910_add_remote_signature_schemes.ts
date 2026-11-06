import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds `remote_signature_schemes`: the outbound HTTP signature scheme
// (`cavage` or `rfc9421`) learned by `signedActivityPubRequest` per normalized
// remote host (`normalizeActorHost`), shared across workers and cold starts
// with a bounded TTL (`expiresAt`) so expired rows are pruned cleanly.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('remote_signature_schemes')
    .ifNotExists()
    .addColumn('domain', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('scheme', 'varchar(16)', (col) => col.notNull())
    .addColumn('expiresAt', timestampType, (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('remote_signature_schemes_expires_at_idx')
    .ifNotExists()
    .on('remote_signature_schemes')
    .column('expiresAt')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('remote_signature_schemes_expires_at_idx')
    .ifExists()
    .execute()
  await db.schema.dropTable('remote_signature_schemes').ifExists().execute()
}
