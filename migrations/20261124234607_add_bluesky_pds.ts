import { type Kysely, SqliteAdapter, sql } from 'kysely'

// Adds the six tables behind the embedded ATProto PDS core:
// - `pds_repos`: one repository per local actor, keyed by DID, holding the
//   encrypted secp256k1 signing key and current head (`rootCid`, `rev`).
// - `pds_blocks`: content-addressed MST/commit/record DAG-CBOR blocks per repo.
// - `pds_records`: indexed ATProto records per repo/collection/rkey.
// - `pds_events`: sequentially numbered repo/identity/account event log.
// - `pds_blobs`: uploaded blobs stored byte-for-byte in media storage.
// - `pds_record_blobs`: references from records to blobs for GC and listing.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'
  const binaryType = isSqlite ? 'blob' : 'bytea'

  await db.schema
    .createTable('pds_repos')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('domain', 'varchar(255)', (col) => col.notNull())
    .addColumn('signingKey', 'text', (col) => col.notNull())
    .addColumn('signingKeyDid', 'varchar(255)', (col) => col.notNull())
    .addColumn('rootCid', 'varchar(255)')
    .addColumn('rev', 'varchar(32)')
    .addColumn('status', 'varchar(16)', (col) =>
      col.notNull().defaultTo('active')
    )
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updatedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('pds_repos_domain_idx')
    .ifNotExists()
    .on('pds_repos')
    .column('domain')
    .execute()

  await db.schema
    .createTable('pds_blocks')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.notNull())
    .addColumn('cid', 'varchar(255)', (col) => col.notNull())
    .addColumn('bytes', binaryType, (col) => col.notNull())
    .addColumn('repoRev', 'varchar(32)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('pds_blocks_pkey', ['did', 'cid'])
    .execute()

  await db.schema
    .createIndex('pds_blocks_did_repo_rev_idx')
    .ifNotExists()
    .on('pds_blocks')
    .columns(['did', 'repoRev'])
    .execute()

  await db.schema
    .createTable('pds_records')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.notNull())
    .addColumn(
      'collection',
      isSqlite ? 'varchar(255)' : sql`varchar(255) collate "C"`,
      (col) => col.notNull()
    )
    .addColumn(
      'rkey',
      isSqlite ? 'varchar(512)' : sql`varchar(512) collate "C"`,
      (col) => col.notNull()
    )
    .addColumn('cid', 'varchar(255)', (col) => col.notNull())
    .addColumn('repoRev', 'varchar(32)', (col) => col.notNull())
    .addColumn('indexedAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('pds_records_pkey', ['did', 'collection', 'rkey'])
    .execute()

  await db.schema
    .createIndex('pds_records_did_repo_rev_idx')
    .ifNotExists()
    .on('pds_records')
    .columns(['did', 'repoRev'])
    .execute()

  let eventsTable = db.schema.createTable('pds_events').ifNotExists()
  eventsTable = isSqlite
    ? eventsTable.addColumn('seq', 'integer', (col) =>
        col.primaryKey().autoIncrement()
      )
    : eventsTable.addColumn('seq', 'bigserial', (col) => col.primaryKey())

  await eventsTable
    .addColumn('did', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(16)', (col) => col.notNull())
    .addColumn('payload', binaryType, (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()

  await db.schema
    .createIndex('pds_events_created_at_idx')
    .ifNotExists()
    .on('pds_events')
    .column('createdAt')
    .execute()

  await db.schema
    .createIndex('pds_events_did_seq_idx')
    .ifNotExists()
    .on('pds_events')
    .columns(['did', 'seq'])
    .execute()

  await db.schema
    .createTable('pds_blobs')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.notNull())
    .addColumn('cid', 'varchar(255)', (col) => col.notNull())
    .addColumn('mimeType', 'varchar(255)', (col) => col.notNull())
    .addColumn('size', 'bigint', (col) => col.notNull())
    .addColumn('storageKey', 'varchar(512)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addPrimaryKeyConstraint('pds_blobs_pkey', ['did', 'cid'])
    .execute()

  await db.schema
    .createTable('pds_record_blobs')
    .ifNotExists()
    .addColumn('did', 'varchar(255)', (col) => col.notNull())
    .addColumn('recordUri', 'varchar(2048)', (col) => col.notNull())
    .addColumn('blobCid', 'varchar(255)', (col) => col.notNull())
    .addPrimaryKeyConstraint('pds_record_blobs_pkey', [
      'did',
      'recordUri',
      'blobCid'
    ])
    .execute()

  await db.schema
    .createIndex('pds_record_blobs_did_blob_cid_idx')
    .ifNotExists()
    .on('pds_record_blobs')
    .columns(['did', 'blobCid'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('pds_record_blobs_did_blob_cid_idx')
    .ifExists()
    .execute()
  await db.schema.dropTable('pds_record_blobs').ifExists().execute()
  await db.schema.dropTable('pds_blobs').ifExists().execute()
  await db.schema.dropIndex('pds_events_did_seq_idx').ifExists().execute()
  await db.schema.dropIndex('pds_events_created_at_idx').ifExists().execute()
  await db.schema.dropTable('pds_events').ifExists().execute()
  await db.schema.dropIndex('pds_records_did_repo_rev_idx').ifExists().execute()
  await db.schema.dropTable('pds_records').ifExists().execute()
  await db.schema.dropIndex('pds_blocks_did_repo_rev_idx').ifExists().execute()
  await db.schema.dropTable('pds_blocks').ifExists().execute()
  await db.schema.dropIndex('pds_repos_domain_idx').ifExists().execute()
  await db.schema.dropTable('pds_repos').ifExists().execute()
}
