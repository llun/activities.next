import { type SelectQueryBuilder, type Selectable, sql } from 'kysely'

import type {
  AppendPdsEventParams,
  CommitPdsRepoWriteParams,
  CommitPdsRepoWriteResult,
  CreatePdsBlobParams,
  CreatePdsRepoParams,
  GetPdsPreferencesParams,
  GetPdsRepoByHandleParams,
  GetPdsRepoParams,
  InitializePdsRepoParams,
  InitializePdsRepoResult,
  ListDeletedPdsReposBeforeParams,
  ListPdsBlobsParams,
  ListPdsBlocksParams,
  ListPdsEventsParams,
  ListPdsRecordsParams,
  ListPdsReposParams,
  PdsBlob,
  PdsBlock,
  PdsEvent,
  PdsEventSeqBounds,
  PdsEventType,
  PdsPreferences,
  PdsRecord,
  PdsRepo,
  PdsRepoStatus,
  PutPdsBlocksParams,
  PutPdsPreferencesParams,
  UpdatePdsRepoHeadParams,
  UpdatePdsRepoIdentityParams,
  UpsertPdsRecordParams
} from '@/lib/database/domains/pds/types'
import {
  type DB,
  type Db,
  inTransaction,
  isInTransaction
} from '@/lib/database/kysely'
import type {
  PdsBlobs,
  PdsBlocks,
  PdsEvents,
  PdsRecords,
  PdsRepos
} from '@/lib/database/kysely/db'
import {
  acquirePostgresAdvisoryXactLock,
  byteLength,
  getDialectName,
  notifyPostgresChannel,
  timestampValue
} from '@/lib/database/kysely/dialect'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import {
  PDS_EVENTS_APPEND_LOCK_KEY,
  PDS_EVENTS_NOTIFY_CHANNEL
} from '@/lib/services/pds/constants'

const MAX_LIST_LIMIT = 1000
// 5 columns per pds_blocks row -> 100 rows = 500 parameters (< SQLite 999 limit).
const BLOCK_INSERT_BATCH_SIZE = 100
// 3 columns per pds_record_blobs row -> 200 rows = 600 parameters (< SQLite 999 limit).
const RECORD_BLOB_INSERT_BATCH_SIZE = 200

const clampLimit = (limit: number, fallback: number): number => {
  if (!Number.isFinite(limit) || limit < 1) return fallback
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT)
}

const toDate = (value: Date | number | undefined): Date => {
  if (value === undefined) return new Date()
  return value instanceof Date ? value : new Date(value)
}

const toBuffer = (data: Uint8Array | Buffer): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength)

const PDS_REPO_COLUMNS = [
  'did',
  'actorId',
  'domain',
  'signingKeyDid',
  'rootCid',
  'rev',
  'status',
  'handle',
  'recoveryKeyDid',
  'plcOperation',
  'createdAt',
  'updatedAt'
] as const

type PdsRepoRow = Pick<Selectable<PdsRepos>, (typeof PDS_REPO_COLUMNS)[number]>

const toRepo = (row: PdsRepoRow): PdsRepo => ({
  did: row.did,
  actorId: row.actorId,
  domain: row.domain,
  signingKeyDid: row.signingKeyDid,
  rootCid: row.rootCid ?? null,
  rev: row.rev ?? null,
  status: row.status as PdsRepoStatus,
  handle: row.handle ?? null,
  recoveryKeyDid: row.recoveryKeyDid ?? null,
  plcOperation: row.plcOperation ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const toBlock = (row: Selectable<PdsBlocks>): PdsBlock => ({
  did: row.did,
  cid: row.cid,
  bytes: toBuffer(row.bytes),
  repoRev: row.repoRev,
  createdAt: getCompatibleTime(row.createdAt)
})

const toRecord = (row: Selectable<PdsRecords>): PdsRecord => ({
  did: row.did,
  collection: row.collection,
  rkey: row.rkey,
  cid: row.cid,
  repoRev: row.repoRev,
  indexedAt: getCompatibleTime(row.indexedAt)
})

const toEvent = (row: Selectable<PdsEvents>): PdsEvent => ({
  seq: Number(row.seq),
  did: row.did,
  type: row.type as PdsEventType,
  payload: toBuffer(row.payload),
  createdAt: getCompatibleTime(row.createdAt)
})

const toBlob = (row: Selectable<PdsBlobs>): PdsBlob => ({
  did: row.did,
  cid: row.cid,
  mimeType: row.mimeType,
  size: Number(row.size),
  storageKey: row.storageKey,
  createdAt: getCompatibleTime(row.createdAt)
})

export const createPdsRepo = async (
  db: Db,
  {
    did,
    actorId,
    domain,
    signingKey,
    signingKeyDid,
    rootCid = null,
    rev = null,
    status = 'active',
    handle = null,
    plcOperation = null
  }: CreatePdsRepoParams
): Promise<PdsRepo> => {
  const now = new Date()
  const row = await db
    .insertInto('pds_repos')
    .values({
      did,
      actorId,
      domain,
      signingKey,
      signingKeyDid,
      rootCid,
      rev,
      status,
      // Stored lowercase: `getPdsRepoByHandle` and the unique index on live
      // handles compare it as is.
      handle: handle?.toLowerCase() ?? null,
      plcOperation,
      createdAt: now,
      updatedAt: now
    })
    .returning(PDS_REPO_COLUMNS)
    .executeTakeFirstOrThrow()
  return toRepo(row)
}

export const getPdsRepo = async (
  db: Db,
  params: GetPdsRepoParams
): Promise<PdsRepo | null> => {
  const query = db.selectFrom('pds_repos').select(PDS_REPO_COLUMNS)
  const row = await (
    'did' in params && params.did !== undefined
      ? query.where('did', '=', params.did)
      : query.where('actorId', '=', params.actorId)
  ).executeTakeFirst()
  return row ? toRepo(row) : null
}

export const getPdsRepoSigningKey = async (
  db: Db,
  { did }: { did: string }
): Promise<string | null> => {
  const row = await db
    .selectFrom('pds_repos')
    .select('signingKey')
    .where('did', '=', did)
    .executeTakeFirst()
  return row?.signingKey ?? null
}

export const getPdsRepoByHandle = async (
  db: Db,
  { handle, domain }: GetPdsRepoByHandleParams
): Promise<PdsRepo | null> => {
  const normalized = handle.trim().toLowerCase()
  if (!normalized) return null
  let query = db
    .selectFrom('pds_repos')
    .select(PDS_REPO_COLUMNS)
    .where('handle', '=', normalized)
  if (domain !== undefined) query = query.where('domain', '=', domain)
  const row = await query
    // A tombstone keeps its handle, which a new account may take again.
    .where('status', '!=', 'deleted')
    .executeTakeFirst()
  return row ? toRepo(row) : null
}

export const listPdsRepos = async (
  db: Db,
  { domain, cursor, limit = 500 }: ListPdsReposParams = {}
): Promise<{ repos: PdsRepo[]; cursor?: string }> => {
  const pageSize = clampLimit(limit, 500)
  let query = db.selectFrom('pds_repos').select(PDS_REPO_COLUMNS)
  if (domain !== undefined) {
    query = query.where('domain', '=', domain)
  }
  if (cursor) {
    query = query.where('did', '>', cursor)
  }
  const rows = await query
    .orderBy('did', 'asc')
    .limit(pageSize + 1)
    .execute()

  const hasMore = rows.length > pageSize
  const slice = hasMore ? rows.slice(0, pageSize) : rows
  return {
    repos: slice.map(toRepo),
    cursor: hasMore ? slice[slice.length - 1]?.did : undefined
  }
}

/**
 * The DIDs of tombstone rows (`status = 'deleted'`) whose `updatedAt` is older
 * than `before`, oldest first. Retention deletes these once the event window
 * has passed.
 */
export const listDeletedPdsReposBefore = async (
  db: Db,
  { before, limit = 500 }: ListDeletedPdsReposBeforeParams
): Promise<string[]> => {
  const rows = await db
    .selectFrom('pds_repos')
    .select('did')
    .where('status', '=', 'deleted')
    .where('updatedAt', '<', timestampValue(before))
    .orderBy('updatedAt', 'asc')
    .limit(clampLimit(limit, 500))
    .execute()
  return rows.map((row) => row.did)
}

export const updatePdsRepoHead = async (
  db: Db,
  { did, rootCid, rev, expectedRev }: UpdatePdsRepoHeadParams
): Promise<boolean> => {
  let query = db
    .updateTable('pds_repos')
    .set({ rootCid, rev, updatedAt: new Date() })
    .where('did', '=', did)
  query =
    expectedRev === null
      ? query.where('rev', 'is', null)
      : query.where('rev', '=', expectedRev)
  const result = await query.executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const updatePdsRepoStatus = async (
  db: Db,
  { did, status }: { did: string; status: PdsRepoStatus }
): Promise<boolean> => {
  const result = await db
    .updateTable('pds_repos')
    .set({
      status,
      updatedAt: new Date(),
      // A tombstone gives up the actor's unique slot, so the actor can host a
      // new account before retention removes the row; the firehose still
      // carries its `#account` events by DID.
      ...(status === 'deleted' ? { actorId: `deleted:${did}` } : {})
    })
    .where('did', '=', did)
    // A tombstone is final: no late write revives or rewrites it.
    .where('status', '!=', 'deleted')
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const updatePdsRepoIdentity = async (
  db: Db,
  { did, handle, recoveryKeyDid, plcOperation }: UpdatePdsRepoIdentityParams
): Promise<boolean> => {
  const updates: {
    updatedAt: Date
    handle?: string | null
    recoveryKeyDid?: string | null
    plcOperation?: string | null
  } = { updatedAt: new Date() }
  if (handle !== undefined) updates.handle = handle?.toLowerCase() ?? null
  if (recoveryKeyDid !== undefined) updates.recoveryKeyDid = recoveryKeyDid
  if (plcOperation !== undefined) updates.plcOperation = plcOperation

  const result = await db
    .updateTable('pds_repos')
    .set(updates)
    .where('did', '=', did)
    .where('status', '!=', 'deleted')
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const getPdsPreferences = async (
  db: Db,
  { did }: GetPdsPreferencesParams
): Promise<PdsPreferences | null> => {
  const row = await db
    .selectFrom('pds_preferences')
    .select('preferences')
    .where('did', '=', did)
    .executeTakeFirst()
  if (!row) return null
  return JSON.parse(row.preferences) as PdsPreferences
}

export const putPdsPreferences = async (
  db: Db,
  { did, preferences }: PutPdsPreferencesParams
): Promise<PdsPreferences> => {
  const serialized = JSON.stringify(preferences)
  const now = new Date()
  await db
    .insertInto('pds_preferences')
    .values({ did, preferences: serialized, updatedAt: now })
    .onConflict((oc) =>
      oc.column('did').doUpdateSet({
        preferences: serialized,
        updatedAt: now
      })
    )
    .execute()
  return preferences
}

export const putPdsBlocks = async (
  db: Db,
  { did, blocks }: PutPdsBlocksParams
): Promise<void> => {
  if (blocks.length === 0) return
  const now = new Date()
  // Deduplicate by cid within the batch (keeping the newest repoRev) so
  // PostgreSQL `ON CONFLICT DO UPDATE` never attempts to update the same row
  // twice in a single INSERT statement.
  const deduped = new Map<
    string,
    {
      did: string
      cid: string
      bytes: Buffer
      repoRev: string
      createdAt: Date
    }
  >()
  for (const block of blocks) {
    const existing = deduped.get(block.cid)
    if (!existing) {
      deduped.set(block.cid, {
        did,
        cid: block.cid,
        bytes: toBuffer(block.bytes),
        repoRev: block.repoRev,
        createdAt: now
      })
    } else if (block.repoRev > existing.repoRev) {
      existing.repoRev = block.repoRev
    }
  }
  const rows = Array.from(deduped.values())

  await inTransaction(db, async (trx) => {
    for (const chunk of chunkArray(rows, BLOCK_INSERT_BATCH_SIZE)) {
      await trx
        .insertInto('pds_blocks')
        .values(chunk)
        .onConflict((oc) =>
          oc.columns(['did', 'cid']).doUpdateSet({
            repoRev: sql<string>`CASE WHEN excluded.${sql.ref('repoRev')} > ${sql.ref('pds_blocks.repoRev')} THEN excluded.${sql.ref('repoRev')} ELSE ${sql.ref('pds_blocks.repoRev')} END`
          })
        )
        .execute()
    }
  })
}

export const getPdsBlocks = async (
  db: Db,
  { did, cids }: { did: string; cids: string[] }
): Promise<PdsBlock[]> => {
  const uniqueCids = Array.from(new Set(cids))
  if (uniqueCids.length === 0) return []

  const results: PdsBlock[] = []
  for (const chunk of chunkArray(uniqueCids, getWhereInBatchSize(db))) {
    const rows = await db
      .selectFrom('pds_blocks')
      .selectAll()
      .where('did', '=', did)
      .where('cid', 'in', chunk)
      .execute()
    for (const row of rows) {
      results.push(toBlock(row))
    }
  }
  return results
}

export const getPdsBlockSizes = async (
  db: Db,
  { did, cids }: { did: string; cids: string[] }
): Promise<Array<{ cid: string; byteLength: number }>> => {
  const uniqueCids = Array.from(new Set(cids))
  if (uniqueCids.length === 0) return []

  const results: Array<{ cid: string; byteLength: number }> = []
  for (const chunk of chunkArray(uniqueCids, getWhereInBatchSize(db))) {
    const rows = await db
      .selectFrom('pds_blocks')
      .select(['cid', byteLength(db, 'bytes').as('byteLength')])
      .where('did', '=', did)
      .where('cid', 'in', chunk)
      .execute()
    for (const row of rows) {
      results.push({
        cid: row.cid,
        byteLength: Number(row.byteLength)
      })
    }
  }
  return results
}

export const getPdsBlocksByRev = async (
  db: Db,
  {
    did,
    repoRev,
    sinceRev
  }: { did: string; repoRev?: string; sinceRev?: string }
): Promise<PdsBlock[]> => {
  let query = db.selectFrom('pds_blocks').selectAll().where('did', '=', did)
  if (repoRev !== undefined) {
    query = query.where('repoRev', '=', repoRev)
  } else if (sinceRev !== undefined) {
    query = query.where('repoRev', '>', sinceRev)
  }
  const rows = await query
    .orderBy('repoRev', 'asc')
    .orderBy('cid', 'asc')
    .execute()
  return rows.map(toBlock)
}

export const listPdsBlocks = async (
  db: Db,
  { did, sinceRev, cursor, limit = 500, maxBytes }: ListPdsBlocksParams
): Promise<{ blocks: PdsBlock[]; cursor?: string }> => {
  const pageSize = clampLimit(limit, 500)
  const boundedMaxBytes =
    maxBytes !== undefined && Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : undefined

  if (boundedMaxBytes !== undefined) {
    let metaQuery = db
      .selectFrom('pds_blocks')
      .select(['cid', byteLength(db, 'bytes').as('byteLength')])
      .where('did', '=', did)
    if (sinceRev !== undefined) {
      metaQuery = metaQuery.where('repoRev', '>', sinceRev)
    }
    if (cursor) {
      metaQuery = metaQuery.where('cid', '>', cursor)
    }
    const metaRows = await metaQuery
      .orderBy('cid', 'asc')
      .limit(pageSize + 1)
      .execute()

    if (metaRows.length === 0) {
      return { blocks: [], cursor: undefined }
    }

    const selectedCids: string[] = []
    let accumulatedBytes = 0
    for (const row of metaRows) {
      if (selectedCids.length >= pageSize) break
      const rowBytes = Number(row.byteLength)
      if (
        selectedCids.length > 0 &&
        accumulatedBytes + rowBytes > boundedMaxBytes
      ) {
        break
      }
      selectedCids.push(row.cid)
      accumulatedBytes += rowBytes
    }

    const hasMore = selectedCids.length < metaRows.length
    const rows = await db
      .selectFrom('pds_blocks')
      .selectAll()
      .where('did', '=', did)
      .where('cid', 'in', selectedCids)
      .orderBy('cid', 'asc')
      .execute()

    return {
      blocks: rows.map(toBlock),
      cursor: hasMore ? selectedCids[selectedCids.length - 1] : undefined
    }
  }

  let query = db.selectFrom('pds_blocks').selectAll().where('did', '=', did)
  if (sinceRev !== undefined) {
    query = query.where('repoRev', '>', sinceRev)
  }
  if (cursor) {
    query = query.where('cid', '>', cursor)
  }
  const rows = await query
    .orderBy('cid', 'asc')
    .limit(pageSize + 1)
    .execute()

  const hasMore = rows.length > pageSize
  const slice = hasMore ? rows.slice(0, pageSize) : rows
  return {
    blocks: slice.map(toBlock),
    cursor: hasMore ? slice[slice.length - 1]?.cid : undefined
  }
}

export const upsertPdsRecord = async (
  db: Db,
  { did, collection, rkey, cid, repoRev, indexedAt }: UpsertPdsRecordParams
): Promise<PdsRecord> => {
  const timestamp = toDate(indexedAt)
  const row = await db
    .insertInto('pds_records')
    .values({
      did,
      collection,
      rkey,
      cid,
      repoRev,
      indexedAt: timestamp
    })
    .onConflict((oc) =>
      oc
        .columns(['did', 'collection', 'rkey'])
        .doUpdateSet({ cid, repoRev, indexedAt: timestamp })
    )
    .returningAll()
    .executeTakeFirstOrThrow()
  return toRecord(row)
}

export const deletePdsRecord = async (
  db: Db,
  { did, collection, rkey }: { did: string; collection: string; rkey: string }
): Promise<boolean> => {
  const result = await db
    .deleteFrom('pds_records')
    .where('did', '=', did)
    .where('collection', '=', collection)
    .where('rkey', '=', rkey)
    .executeTakeFirst()
  return Number(result.numDeletedRows) > 0
}

export const getPdsRecord = async (
  db: Db,
  { did, collection, rkey }: { did: string; collection: string; rkey: string }
): Promise<PdsRecord | null> => {
  const row = await db
    .selectFrom('pds_records')
    .selectAll()
    .where('did', '=', did)
    .where('collection', '=', collection)
    .where('rkey', '=', rkey)
    .executeTakeFirst()
  return row ? toRecord(row) : null
}

export const listPdsRecords = async (
  db: Db,
  { did, collection, cursor, limit = 50, reverse = false }: ListPdsRecordsParams
): Promise<{ records: PdsRecord[]; cursor?: string }> => {
  const pageSize = clampLimit(limit, 50)
  let query = db
    .selectFrom('pds_records')
    .selectAll()
    .where('did', '=', did)
    .where('collection', '=', collection)

  if (cursor) {
    query = reverse
      ? query.where('rkey', '>', cursor)
      : query.where('rkey', '<', cursor)
  }

  const rows = await query
    .orderBy('rkey', reverse ? 'asc' : 'desc')
    .limit(pageSize + 1)
    .execute()

  const hasMore = rows.length > pageSize
  const slice = hasMore ? rows.slice(0, pageSize) : rows
  return {
    records: slice.map(toRecord),
    cursor: hasMore ? slice[slice.length - 1]?.rkey : undefined
  }
}

export const MAX_PDS_COLLECTIONS_LIMIT = MAX_LIST_LIMIT

export const listPdsCollections = async (
  db: Db,
  { did, limit = MAX_PDS_COLLECTIONS_LIMIT }: { did: string; limit?: number }
): Promise<string[]> => {
  const pageSize = clampLimit(limit, MAX_PDS_COLLECTIONS_LIMIT)
  const rows = await db
    .selectFrom('pds_records')
    .select('collection')
    .distinct()
    .where('did', '=', did)
    .orderBy('collection', 'asc')
    .limit(pageSize)
    .execute()
  return rows.map((row) => row.collection)
}

export const appendPdsEvent = async (
  db: Db,
  { did, type, payload, createdAt }: AppendPdsEventParams
): Promise<PdsEvent> => {
  const insertAndNotify = async (executor: Db): Promise<PdsEvent> => {
    await acquirePostgresAdvisoryXactLock(executor, PDS_EVENTS_APPEND_LOCK_KEY)
    const row = await executor
      .insertInto('pds_events')
      .values({
        did,
        type,
        payload: toBuffer(payload),
        createdAt: toDate(createdAt)
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    const event = toEvent(row)
    await notifyPostgresChannel(
      executor,
      PDS_EVENTS_NOTIFY_CHANNEL,
      String(event.seq)
    )
    return event
  }

  // On PostgreSQL, wrap standalone calls in a transaction so the advisory
  // lock, INSERT, and pg_notify always execute on the same connection and
  // commit atomically in sequence order.
  if (getDialectName(db) === 'postgres' && !isInTransaction(db)) {
    return inTransaction(db, insertAndNotify)
  }
  return insertAndNotify(db)
}

export const listPdsEvents = async (
  db: Db,
  {
    afterSeq = 0,
    limit = 100,
    maxBytes,
    did,
    domain,
    activeReposOnly = false
  }: ListPdsEventsParams = {}
): Promise<PdsEvent[]> => {
  const pageSize = clampLimit(limit, 100)
  const boundedMaxBytes =
    maxBytes !== undefined && Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : undefined

  const executeFiltered = <O>(
    base: SelectQueryBuilder<DB, 'pds_events', O>
  ): Promise<O[]> => {
    let query = base.where('pds_events.seq', '>', afterSeq)
    if (did !== undefined) {
      query = query.where('pds_events.did', '=', did)
    }

    if (activeReposOnly) {
      const withRepo =
        domain !== undefined
          ? query
              .innerJoin('pds_repos', 'pds_repos.did', 'pds_events.did')
              .where('pds_repos.domain', '=', domain)
          : query.leftJoin('pds_repos', 'pds_repos.did', 'pds_events.did')

      return withRepo
        .leftJoin('actors', 'actors.id', 'pds_repos.actorId')
        .leftJoin('accounts', 'accounts.id', 'actors.accountId')
        .where((eb) =>
          eb.or([
            eb('pds_events.type', '=', 'account'),
            // A move out turns the repo deactivated and emits `#identity` as it
            // goes, so identity events must stream for a deactivated repo. A
            // suspended, disabled or pending repo's identity cannot change
            // while it is off, so its old `#identity` is not replayed.
            eb.and([
              eb('pds_events.type', '=', 'identity'),
              eb('pds_repos.status', '=', 'deactivated')
            ]),
            eb.and([
              eb('pds_repos.status', '=', 'active'),
              eb('actors.id', 'is not', null),
              eb('actors.suspendedAt', 'is', null),
              eb.or([
                eb('actors.deletionStatus', 'is', null),
                eb('actors.deletionStatus', '=', '')
              ]),
              eb('accounts.id', 'is not', null),
              eb('accounts.disabledAt', 'is', null),
              eb('accounts.approvedAt', 'is not', null),
              eb.or([
                eb('accounts.verificationCode', 'is', null),
                eb('accounts.verificationCode', '=', ''),
                eb('accounts.emailVerified', '=', true)
              ])
            ])
          ])
        )
        .orderBy('pds_events.seq', 'asc')
        .limit(pageSize)
        .execute()
    }

    if (domain !== undefined) {
      return query
        .innerJoin('pds_repos', 'pds_repos.did', 'pds_events.did')
        .where('pds_repos.domain', '=', domain)
        .orderBy('pds_events.seq', 'asc')
        .limit(pageSize)
        .execute()
    }

    return query.orderBy('pds_events.seq', 'asc').limit(pageSize).execute()
  }

  if (boundedMaxBytes !== undefined) {
    const metaRows = await executeFiltered(
      db
        .selectFrom('pds_events')
        .select([
          'pds_events.seq',
          byteLength(db, 'pds_events.payload').as('byteLength')
        ])
    )

    if (metaRows.length === 0) {
      return []
    }

    const selectedSeqs: number[] = []
    let accumulatedBytes = 0
    for (const row of metaRows) {
      const rowBytes = Number(row.byteLength)
      if (
        selectedSeqs.length > 0 &&
        accumulatedBytes + rowBytes > boundedMaxBytes
      ) {
        break
      }
      selectedSeqs.push(Number(row.seq))
      accumulatedBytes += rowBytes
    }

    const events: PdsEvent[] = []
    for (const chunk of chunkArray(selectedSeqs, getWhereInBatchSize(db))) {
      const rows = await db
        .selectFrom('pds_events')
        .selectAll()
        .where('seq', 'in', chunk)
        .orderBy('seq', 'asc')
        .execute()
      for (const row of rows) {
        events.push(toEvent(row))
      }
    }
    return events
  }

  const rows = await executeFiltered(
    db.selectFrom('pds_events').selectAll('pds_events')
  )
  return rows.map(toEvent)
}

export const getPdsEventSeqBounds = async (
  db: Db
): Promise<PdsEventSeqBounds> => {
  const row = await db
    .selectFrom('pds_events')
    .select([
      sql<number | string | null>`min(${sql.ref('seq')})`.as('oldest'),
      sql<number | string | null>`max(${sql.ref('seq')})`.as('newest')
    ])
    .executeTakeFirst()

  return {
    oldest:
      row?.oldest === null || row?.oldest === undefined
        ? null
        : Number(row.oldest),
    newest:
      row?.newest === null || row?.newest === undefined
        ? null
        : Number(row.newest)
  }
}

export const deletePdsEventsBefore = async (
  db: Db,
  { before }: { before: Date | number }
): Promise<number> => {
  const result = await db
    .deleteFrom('pds_events')
    .where('createdAt', '<', timestampValue(before))
    .executeTakeFirst()
  return Number(result.numDeletedRows)
}

export const createPdsBlob = async (
  db: Db,
  { did, cid, mimeType, size, storageKey, createdAt }: CreatePdsBlobParams
): Promise<PdsBlob> => {
  await db
    .insertInto('pds_blobs')
    .values({
      did,
      cid,
      mimeType,
      size,
      storageKey,
      createdAt: toDate(createdAt)
    })
    .onConflict((oc) => oc.columns(['did', 'cid']).doNothing())
    .execute()

  const row = await db
    .selectFrom('pds_blobs')
    .selectAll()
    .where('did', '=', did)
    .where('cid', '=', cid)
    .executeTakeFirstOrThrow()
  return toBlob(row)
}

export const getPdsBlob = async (
  db: Db,
  {
    did,
    cid,
    includeUnreferenced = false
  }: { did: string; cid: string; includeUnreferenced?: boolean }
): Promise<PdsBlob | null> => {
  let query = db
    .selectFrom('pds_blobs')
    .selectAll()
    .where('did', '=', did)
    .where('cid', '=', cid)
  if (!includeUnreferenced) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('pds_record_blobs')
          .select(sql`1`.as('one'))
          .whereRef('pds_record_blobs.did', '=', 'pds_blobs.did')
          .whereRef('pds_record_blobs.blobCid', '=', 'pds_blobs.cid')
      )
    )
  }
  const row = await query.executeTakeFirst()
  return row ? toBlob(row) : null
}

export const listPdsBlobs = async (
  db: Db,
  { did, since, cursor, limit = 500 }: ListPdsBlobsParams
): Promise<{ blobs: PdsBlob[]; cursor?: string }> => {
  const pageSize = clampLimit(limit, 500)
  let query = db.selectFrom('pds_blobs').selectAll().where('did', '=', did)
  if (since) {
    query = query.where('cid', 'in', (eb) =>
      eb
        .selectFrom('pds_record_blobs')
        .innerJoin('pds_records', (join) =>
          join
            .onRef('pds_records.did', '=', 'pds_record_blobs.did')
            .on(
              sql<boolean>`${sql.ref('pds_record_blobs.recordUri')} = ('at://' || ${sql.ref('pds_records.did')} || '/' || ${sql.ref('pds_records.collection')} || '/' || ${sql.ref('pds_records.rkey')})`
            )
        )
        .select('pds_record_blobs.blobCid')
        .where('pds_record_blobs.did', '=', did)
        .where('pds_records.repoRev', '>', since)
    )
  } else {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('pds_record_blobs')
          .select(sql`1`.as('one'))
          .whereRef('pds_record_blobs.did', '=', 'pds_blobs.did')
          .whereRef('pds_record_blobs.blobCid', '=', 'pds_blobs.cid')
      )
    )
  }
  if (cursor) {
    query = query.where('cid', '>', cursor)
  }
  const rows = await query
    .orderBy('cid', 'asc')
    .limit(pageSize + 1)
    .execute()

  const hasMore = rows.length > pageSize
  const slice = hasMore ? rows.slice(0, pageSize) : rows
  return {
    blobs: slice.map(toBlob),
    cursor: hasMore ? slice[slice.length - 1]?.cid : undefined
  }
}

export const listPdsBlobStorageKeys = async (
  db: Db,
  { did }: { did: string }
): Promise<string[]> => {
  const rows = await db
    .selectFrom('pds_blobs')
    .select('storageKey')
    .where('did', '=', did)
    .execute()
  return rows.map((row) => row.storageKey)
}

export const deletePdsBlob = async (
  db: Db,
  { did, cid, storageKey }: { did: string; cid: string; storageKey?: string }
): Promise<boolean> => {
  let query = db
    .deleteFrom('pds_blobs')
    .where('did', '=', did)
    .where('cid', '=', cid)
  if (storageKey !== undefined) {
    query = query.where('storageKey', '=', storageKey)
  }
  const result = await query.executeTakeFirst()
  return Number(result.numDeletedRows) > 0
}

export const putPdsRecordBlobs = async (
  db: Db,
  {
    did,
    recordUri,
    blobCids
  }: { did: string; recordUri: string; blobCids: string[] }
): Promise<void> => {
  const uniqueCids = Array.from(new Set(blobCids))
  if (uniqueCids.length === 0) return

  const rows = uniqueCids.map((blobCid) => ({
    did,
    recordUri,
    blobCid
  }))

  await inTransaction(db, async (trx) => {
    for (const chunk of chunkArray(rows, RECORD_BLOB_INSERT_BATCH_SIZE)) {
      await trx
        .insertInto('pds_record_blobs')
        .values(chunk)
        .onConflict((oc) =>
          oc.columns(['did', 'recordUri', 'blobCid']).doNothing()
        )
        .execute()
    }
  })
}

export const deletePdsRecordBlobs = async (
  db: Db,
  { did, recordUri }: { did: string; recordUri: string }
): Promise<void> => {
  await db
    .deleteFrom('pds_record_blobs')
    .where('did', '=', did)
    .where('recordUri', '=', recordUri)
    .execute()
}

export const getPdsRecordBlobs = async (
  db: Db,
  { did, recordUri }: { did: string; recordUri: string }
): Promise<string[]> => {
  const rows = await db
    .selectFrom('pds_record_blobs')
    .select('blobCid')
    .where('did', '=', did)
    .where('recordUri', '=', recordUri)
    .orderBy('blobCid', 'asc')
    .execute()
  return rows.map((row) => row.blobCid)
}

export const countPdsBlobReferences = async (
  db: Db,
  { did, blobCid }: { did: string; blobCid: string }
): Promise<number> => {
  const row = await db
    .selectFrom('pds_record_blobs')
    .select(sql<number>`count(*)`.as('count'))
    .where('did', '=', did)
    .where('blobCid', '=', blobCid)
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

/**
 * Atomically initializes a new PDS repo: inserts `pds_repos` with its initial
 * head, writes the initial commit + MST blocks, and appends the initial events
 * (`identity`, `account`, `commit`) in order.
 */
export const initializePdsRepo = async (
  db: Db,
  {
    did,
    actorId,
    domain,
    signingKey,
    signingKeyDid,
    rootCid,
    rev,
    status = 'active',
    handle = null,
    plcOperation = null,
    blocks,
    events
  }: InitializePdsRepoParams
): Promise<InitializePdsRepoResult> =>
  inTransaction(db, async (trx) => {
    const repo = await createPdsRepo(trx, {
      did,
      actorId,
      domain,
      signingKey,
      signingKeyDid,
      rootCid,
      rev,
      status,
      handle,
      plcOperation
    })

    if (blocks.length > 0) {
      await putPdsBlocks(trx, {
        did,
        blocks: blocks.map((block) => ({
          cid: block.cid,
          bytes: block.bytes,
          repoRev: rev
        }))
      })
    }

    const appendedEvents: PdsEvent[] = []
    for (const event of events) {
      appendedEvents.push(
        await appendPdsEvent(trx, {
          did,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt
        })
      )
    }

    return { repo, events: appendedEvents }
  })

/**
 * Atomically writes a single repo commit: optimistic head update, new blocks,
 * record upserts/deletes with record-blob links, superseded block cleanup, and
 * the sequenced event.
 *
 * Updates the head first so PostgreSQL acquires the row lock on `pds_repos`
 * before any child write and returns `{ committed: false, event: null }` with
 * zero writes when `expectedRev` does not match.
 */
export const commitPdsRepoWrite = async (
  db: Db,
  {
    did,
    rootCid,
    rev,
    expectedRev,
    blocks,
    removedBlockCids,
    recordWrites,
    event,
    indexedAt
  }: CommitPdsRepoWriteParams
): Promise<CommitPdsRepoWriteResult> =>
  inTransaction(db, async (trx) => {
    const updated = await updatePdsRepoHead(trx, {
      did,
      rootCid,
      rev,
      expectedRev
    })
    if (!updated) {
      return { committed: false, event: null, deletedBlobStorageKeys: [] }
    }

    if (blocks.length > 0) {
      await putPdsBlocks(trx, {
        did,
        blocks: blocks.map((block) => ({
          cid: block.cid,
          bytes: block.bytes,
          repoRev: rev
        }))
      })
    }

    const candidateRemovedBlobCids = new Set<string>()
    for (const write of recordWrites) {
      const recordUri =
        write.recordUri ?? `at://${did}/${write.collection}/${write.rkey}`
      if (write.action === 'delete') {
        const previousBlobCids = await getPdsRecordBlobs(trx, {
          did,
          recordUri
        })
        for (const blobCid of previousBlobCids) {
          candidateRemovedBlobCids.add(blobCid)
        }
        await deletePdsRecord(trx, {
          did,
          collection: write.collection,
          rkey: write.rkey
        })
        await deletePdsRecordBlobs(trx, { did, recordUri })
      } else {
        await upsertPdsRecord(trx, {
          did,
          collection: write.collection,
          rkey: write.rkey,
          cid: write.cid,
          repoRev: rev,
          indexedAt
        })
        if (write.blobCids !== undefined) {
          const previousBlobCids = await getPdsRecordBlobs(trx, {
            did,
            recordUri
          })
          for (const blobCid of previousBlobCids) {
            candidateRemovedBlobCids.add(blobCid)
          }
          await deletePdsRecordBlobs(trx, { did, recordUri })
          if (write.blobCids.length > 0) {
            await putPdsRecordBlobs(trx, {
              did,
              recordUri,
              blobCids: write.blobCids
            })
          }
        }
      }
    }

    const deletedBlobStorageKeys: string[] = []
    if (candidateRemovedBlobCids.size > 0) {
      const candidateBlobs = Array.from(candidateRemovedBlobCids)
      const stillReferencedBlobs = new Set<string>()
      for (const chunk of chunkArray(
        candidateBlobs,
        getWhereInBatchSize(trx)
      )) {
        const rows = await trx
          .selectFrom('pds_record_blobs')
          .select('blobCid')
          .where('did', '=', did)
          .where('blobCid', 'in', chunk)
          .execute()
        for (const row of rows) {
          stillReferencedBlobs.add(row.blobCid)
        }
      }

      const unreferencedBlobCids = candidateBlobs.filter(
        (cid) => !stillReferencedBlobs.has(cid)
      )
      for (const chunk of chunkArray(
        unreferencedBlobCids,
        getWhereInBatchSize(trx)
      )) {
        const deleted = await trx
          .deleteFrom('pds_blobs')
          .where('did', '=', did)
          .where('cid', 'in', chunk)
          .returning('storageKey')
          .execute()
        for (const row of deleted) {
          deletedBlobStorageKeys.push(row.storageKey)
        }
      }
    }

    if (removedBlockCids && removedBlockCids.length > 0) {
      const addedCids = new Set(blocks.map((block) => block.cid))
      const candidateCids = Array.from(new Set(removedBlockCids)).filter(
        (cid) => !addedCids.has(cid)
      )

      if (candidateCids.length > 0) {
        const stillReferenced = new Set<string>()
        for (const chunk of chunkArray(
          candidateCids,
          getWhereInBatchSize(trx)
        )) {
          const rows = await trx
            .selectFrom('pds_records')
            .select('cid')
            .where('did', '=', did)
            .where('cid', 'in', chunk)
            .execute()
          for (const row of rows) {
            stillReferenced.add(row.cid)
          }
        }

        const cidsToDelete = candidateCids.filter(
          (cid) => !stillReferenced.has(cid)
        )
        for (const chunk of chunkArray(
          cidsToDelete,
          getWhereInBatchSize(trx)
        )) {
          await trx
            .deleteFrom('pds_blocks')
            .where('did', '=', did)
            .where('cid', 'in', chunk)
            .execute()
        }
      }
    }

    const appendedEvent = event
      ? await appendPdsEvent(trx, {
          did,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt
        })
      : null

    return { committed: true, event: appendedEvent, deletedBlobStorageKeys }
  })

export const deletePdsRepoData = async (
  db: Db,
  { did }: { did: string }
): Promise<{ blobStorageKeys: string[] }> =>
  inTransaction(db, async (trx) => {
    const blobs = await trx
      .selectFrom('pds_blobs')
      .select('storageKey')
      .where('did', '=', did)
      .execute()
    await trx.deleteFrom('pds_record_blobs').where('did', '=', did).execute()
    await trx.deleteFrom('pds_blobs').where('did', '=', did).execute()
    await trx.deleteFrom('pds_events').where('did', '=', did).execute()
    await trx.deleteFrom('pds_records').where('did', '=', did).execute()
    await trx.deleteFrom('pds_blocks').where('did', '=', did).execute()
    await trx.deleteFrom('pds_preferences').where('did', '=', did).execute()
    await trx.deleteFrom('pds_repos').where('did', '=', did).execute()
    return { blobStorageKeys: blobs.map((blob) => blob.storageKey) }
  })

/**
 * Removes a repo's records, blocks, blobs, record-blob references and
 * preferences, keeping the `pds_repos` tombstone row and its `pds_events`
 * history.
 */
export const deletePdsRepoContent = async (
  db: Db,
  { did }: { did: string }
): Promise<{ blobStorageKeys: string[] }> =>
  inTransaction(db, async (trx) => {
    const blobs = await trx
      .selectFrom('pds_blobs')
      .select('storageKey')
      .where('did', '=', did)
      .execute()
    await trx.deleteFrom('pds_record_blobs').where('did', '=', did).execute()
    await trx.deleteFrom('pds_blobs').where('did', '=', did).execute()
    await trx.deleteFrom('pds_records').where('did', '=', did).execute()
    await trx.deleteFrom('pds_blocks').where('did', '=', did).execute()
    await trx.deleteFrom('pds_preferences').where('did', '=', did).execute()
    return { blobStorageKeys: blobs.map((blob) => blob.storageKey) }
  })

export const pdsQueries = {
  createPdsRepo,
  getPdsRepo,
  getPdsRepoByHandle,
  getPdsRepoSigningKey,
  listPdsRepos,
  listDeletedPdsReposBefore,
  updatePdsRepoHead,
  updatePdsRepoIdentity,
  updatePdsRepoStatus,
  getPdsPreferences,
  putPdsPreferences,
  putPdsBlocks,
  getPdsBlocks,
  getPdsBlockSizes,
  getPdsBlocksByRev,
  listPdsBlocks,
  upsertPdsRecord,
  deletePdsRecord,
  getPdsRecord,
  listPdsRecords,
  listPdsCollections,
  appendPdsEvent,
  listPdsEvents,
  getPdsEventSeqBounds,
  deletePdsEventsBefore,
  createPdsBlob,
  getPdsBlob,
  listPdsBlobs,
  listPdsBlobStorageKeys,
  deletePdsBlob,
  putPdsRecordBlobs,
  deletePdsRecordBlobs,
  getPdsRecordBlobs,
  countPdsBlobReferences,
  initializePdsRepo,
  commitPdsRepoWrite,
  deletePdsRepoData,
  deletePdsRepoContent
}
