import { randomBytes } from 'crypto'
import type { Selectable } from 'kysely'

import { inTransaction } from '@/lib/database/kysely'
import type { Db } from '@/lib/database/kysely'
import type {
  AccountImportItems,
  AccountImports
} from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import type {
  AccountImport,
  AccountImportItem,
  AccountImportOutcomeReport
} from '@/lib/types/domain/accountImport'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import type {
  AccountImportItemReference,
  ClaimAccountImportRunParams,
  ClaimAccountImportRunResult,
  CreateAccountImportParams,
  GetAccountImportItemReferencesParams,
  GetAccountImportItemsParams,
  GetExpiredQueuedAccountImportsParams,
  GetStaleAccountImportsParams,
  ListAccountImportsParams,
  MarkAccountImportItemParams,
  ReleaseAccountImportRunParams,
  RenewAccountImportRunParams,
  ResetRetryableAccountImportItemsParams,
  UpdateAccountImportParams,
  UpsertAccountImportItemsParams
} from './types'

type Row = Selectable<AccountImports>
type ItemRow = Selectable<AccountImportItems>

const toImport = (row: Row): AccountImport => ({
  id: row.id,
  accountId: row.accountId,
  actorId: row.actorId,
  status: row.status as AccountImport['status'],
  kind: row.kind ?? null,
  archiveETag: row.archiveETag ?? null,
  options: row.options,
  storageToken: row.storageToken,
  uploadedBytes: Number(row.uploadedBytes),
  progress: row.progress ?? null,
  phase: row.phase ?? null,
  cursor: row.cursor ?? null,
  runToken: row.runToken ?? null,
  claimedUntil: row.claimedUntil ? new Date(row.claimedUntil).getTime() : null,
  lastErrorCode: row.lastErrorCode ?? null,
  createdAt: new Date(row.createdAt).getTime(),
  startedAt: row.startedAt ? new Date(row.startedAt).getTime() : null,
  finishedAt: row.finishedAt ? new Date(row.finishedAt).getTime() : null,
  updatedAt: new Date(row.updatedAt).getTime()
})

const toItem = (row: ItemRow): AccountImportItem => ({
  ...row,
  state: row.state as AccountImportItem['state']
})

export const createAccountImport = async (
  db: Db,
  params: CreateAccountImportParams
): Promise<AccountImport> => {
  const now = new Date()
  const row = await db
    .insertInto('account_imports')
    .values({
      id: params.id,
      accountId: params.accountId,
      actorId: params.actorId,
      status: 'queued',
      options: params.options,
      ...(params.uploadedBytes === undefined
        ? null
        : { uploadedBytes: params.uploadedBytes }),
      storageToken: randomBytes(32).toString('base64url'),
      createdAt: now,
      updatedAt: now
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  return toImport(row)
}

export const getAccountImport = async (
  db: Db,
  params: { id: string; actorId: string }
): Promise<AccountImport | null> => {
  const row = await db
    .selectFrom('account_imports')
    .selectAll()
    .where('id', '=', params.id)
    .where('actorId', '=', params.actorId)
    .executeTakeFirst()
  return row ? toImport(row) : null
}

export const getActiveAccountImport = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<AccountImport | null> => {
  const row = await db
    .selectFrom('account_imports')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('status', 'in', ['queued', 'running'])
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toImport(row) : null
}

export const getStaleAccountImports = async (
  db: Db,
  params: GetStaleAccountImportsParams
): Promise<AccountImport[]> => {
  let query = db
    .selectFrom('account_imports')
    .selectAll()
    .where('status', '=', 'running')
    .where('updatedAt', '<=', timestampValue(params.before))
    .where((eb) =>
      eb.or([
        eb('claimedUntil', 'is', null),
        eb('claimedUntil', '<=', timestampValue(params.now))
      ])
    )
  if (params.afterId !== undefined) {
    query = query.where('id', '>', params.afterId)
  }
  const rows = await query.orderBy('id', 'asc').limit(params.limit).execute()
  return rows.map(toImport)
}

// Uploads that were never started: a queued import whose upload has sat in
// object storage past the expiry bound. The sweep fails these rows and deletes
// the upload, so an abandoned upload cannot keep personal data forever.
export const getExpiredQueuedAccountImports = async (
  db: Db,
  params: GetExpiredQueuedAccountImportsParams
): Promise<AccountImport[]> => {
  let query = db
    .selectFrom('account_imports')
    .selectAll()
    .where('status', '=', 'queued')
    .where('createdAt', '<=', timestampValue(params.before))
  if (params.afterId !== undefined) {
    query = query.where('id', '>', params.afterId)
  }
  const rows = await query.orderBy('id', 'asc').limit(params.limit).execute()
  return rows.map(toImport)
}

export const listAccountImports = async (
  db: Db,
  params: ListAccountImportsParams
): Promise<AccountImport[]> => {
  const rows = await db
    .selectFrom('account_imports')
    .selectAll()
    .where('actorId', '=', params.actorId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit)
    .execute()
  return rows.map(toImport)
}

// The start limit is per ACCOUNT (every profile of the account shares it),
// not per actor: the plan's decision is 3 starts per account per 24 h.
export const countAccountImportStartsSince = async (
  db: Db,
  params: { accountId: string; since: number }
): Promise<number> => {
  const { count } = await db
    .selectFrom('account_imports')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('accountId', '=', params.accountId)
    .where('startedAt', '>=', timestampValue(params.since))
    .executeTakeFirstOrThrow()
  return Number(count)
}

export const getOldestAccountImportStartSince = async (
  db: Db,
  params: { accountId: string; since: number }
): Promise<number | null> => {
  const { oldestStartedAt } = await db
    .selectFrom('account_imports')
    .select((eb) => eb.fn.min('startedAt').as('oldestStartedAt'))
    .where('accountId', '=', params.accountId)
    .where('startedAt', '>=', timestampValue(params.since))
    .executeTakeFirstOrThrow()
  return oldestStartedAt === null ? null : new Date(oldestStartedAt).getTime()
}

export const updateAccountImport = async (
  db: Db,
  params: UpdateAccountImportParams
): Promise<boolean> => {
  const values: Record<string, unknown> = { updatedAt: new Date() }
  if (params.status !== undefined) values.status = params.status
  if (params.kind !== undefined) values.kind = params.kind
  if (params.progress !== undefined) values.progress = params.progress
  if (params.phase !== undefined) values.phase = params.phase
  if (params.cursor !== undefined) values.cursor = params.cursor
  if (params.archiveETag !== undefined) {
    values.archiveETag = params.archiveETag
  }
  if (params.uploadedBytes !== undefined) {
    values.uploadedBytes = params.uploadedBytes
  }
  if (params.runToken !== undefined) values.runToken = params.runToken
  if (params.claimedUntil !== undefined) {
    values.claimedUntil =
      params.claimedUntil === null ? null : new Date(params.claimedUntil)
  }
  if (params.lastErrorCode !== undefined) {
    values.lastErrorCode = params.lastErrorCode
  }
  if (params.startedAt !== undefined) values.startedAt = params.startedAt
  if (params.finishedAt !== undefined) values.finishedAt = params.finishedAt

  const terminal =
    params.status === 'done' ||
    params.status === 'failed' ||
    params.status === 'cancelled'
  const update = async (connection: Db) => {
    let query = connection
      .updateTable('account_imports')
      .set(values)
      .where('id', '=', params.id)
    if (params.onlyIfStatus) {
      query = query.where('status', 'in', params.onlyIfStatus)
    }
    const result = await query.executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) return false
    if (terminal) {
      await connection
        .updateTable('account_import_items')
        .set({ data: null })
        .where('importId', '=', params.id)
        .execute()
    }
    return true
  }

  return terminal ? inTransaction(db, update) : update(db)
}

// The lease is computed and compared with the app server's clock, not the
// database's (see claimBulkImportRun): SQLite stores these timestamps as epoch
// milliseconds while PostgreSQL compares timestamptz. Takes the import for one
// run; the lease lapses by itself, so a run that died never blocks the import.
export const claimAccountImportRun = async (
  db: Db,
  params: ClaimAccountImportRunParams
): Promise<ClaimAccountImportRunResult> => {
  const now = Date.now()
  const result = await db
    .updateTable('account_imports')
    .set({
      runToken: params.runToken,
      claimedUntil: new Date(now + params.leaseMs)
    })
    .where('id', '=', params.id)
    .where((eb) =>
      eb.or([
        eb('claimedUntil', 'is', null),
        eb('claimedUntil', '<', timestampValue(now))
      ])
    )
    .executeTakeFirst()

  if (Number(result.numUpdatedRows) > 0) return { claimed: true }

  const current = await db
    .selectFrom('account_imports')
    .select(['runToken', 'claimedUntil'])
    .where('id', '=', params.id)
    .executeTakeFirst()
  return {
    claimed: false,
    runToken: current?.runToken ?? null,
    claimedUntil: current?.claimedUntil
      ? new Date(current.claimedUntil).getTime()
      : null
  }
}

// Extends a claim this run still holds. Zero rows changed means another run
// owns the import now, and this one must stop without writing anything more.
export const renewAccountImportRun = async (
  db: Db,
  params: RenewAccountImportRunParams
): Promise<boolean> => {
  const result = await db
    .updateTable('account_imports')
    .set({ claimedUntil: new Date(Date.now() + params.leaseMs) })
    .where('id', '=', params.id)
    .where('runToken', '=', params.runToken)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

// Only clears a claim this run still holds; a lapsed one may already be
// another run's.
export const releaseAccountImportRun = async (
  db: Db,
  params: ReleaseAccountImportRunParams
): Promise<void> => {
  await db
    .updateTable('account_imports')
    .set({ runToken: null, claimedUntil: null })
    .where('id', '=', params.id)
    .where('runToken', '=', params.runToken)
    .execute()
}

// The item id is a deterministic function of the import and the source key.
// The actor-wide source key reuses completed items and lets pending or failed
// items move to the new import without creating duplicates.
export const getAccountImportItemId = (
  importId: string,
  kind: string,
  sourceId: string
): string => `${importId}:${kind}:${getHashFromString(sourceId)}`

/**
 * Skip reasons that depend on an option the owner chose at start (likes or
 * bookmarks off, replies to others left out) or on a size limit (media,
 * fitness), not on the item itself: a later import that turns the option on,
 * or that runs after the limit was raised, must be able to claim the row
 * again. Every other skipped row keeps its verdict. A quota skip is here for
 * the same reason: a later import that runs after space was freed retries
 * the media it could not store.
 */
export const RECLAIMABLE_SKIPPED_ITEM_REASONS = [
  'option_disabled',
  'reply-to-other',
  'media_too_large',
  'media_quota_exceeded',
  'fitness_too_large'
] as const

export const upsertAccountImportItems = async (
  db: Db,
  params: UpsertAccountImportItemsParams
): Promise<void> => {
  if (params.items.length === 0) return
  const items = [
    ...new Map(
      params.items.map((item) => [
        JSON.stringify([item.kind, item.sourceId]),
        item
      ])
    ).values()
  ]
  await db
    .insertInto('account_import_items')
    .values(
      items.map((item) => ({
        id: getAccountImportItemId(params.importId, item.kind, item.sourceId),
        importId: params.importId,
        actorId: params.actorId,
        kind: item.kind,
        sourceId: item.sourceId,
        position: item.position,
        data: item.data ?? null
      }))
    )
    .onConflict((oc) =>
      oc
        .columns(['actorId', 'kind', 'sourceId'])
        .doUpdateSet((eb) => ({
          importId: eb.ref('excluded.importId'),
          position: eb.ref('excluded.position'),
          data: eb.ref('excluded.data'),
          state: 'pending',
          reason: null,
          targetId: null,
          updatedAt: eb.ref('excluded.updatedAt')
        }))
        .where((eb) =>
          eb.or([
            eb('account_import_items.state', 'in', ['pending', 'failed']),
            eb.and([
              eb('account_import_items.state', '=', 'skipped'),
              eb('account_import_items.reason', 'in', [
                ...RECLAIMABLE_SKIPPED_ITEM_REASONS
              ])
            ])
          ])
        )
    )
    .execute()
}

export const getAccountImportItems = async (
  db: Db,
  params: GetAccountImportItemsParams
): Promise<AccountImportItem[]> => {
  let query = db
    .selectFrom('account_import_items')
    .selectAll()
    .where('importId', '=', params.importId)
    .orderBy('position', 'asc')
  if (params.states !== undefined) {
    query = query.where('state', 'in', [...params.states])
  }
  if (params.kinds !== undefined) {
    query = query.where('kind', 'in', [...params.kinds])
  }
  if (params.afterPosition !== undefined) {
    query = query.where('position', '>', params.afterPosition)
  }
  const rows = await query.limit(params.limit).execute()
  return rows.map(toItem)
}

// Resolve only references on the current item page. Keeping the key list
// bounded also stays below SQLite's bind-variable limit for large collections.
// The actor/kind/sourceId filter follows the unique actor source-key index.
export const getAccountImportItemReferences = async (
  db: Db,
  params: GetAccountImportItemReferencesParams
): Promise<AccountImportItemReference[]> => {
  if (params.kinds.length === 0 || params.sourceIds.length === 0) return []
  const sourceIds = [...new Set(params.sourceIds)]
  const result: AccountImportItemReference[] = []
  for (let offset = 0; offset < sourceIds.length; offset += 300) {
    const rows = await db
      .selectFrom('account_import_items')
      .select(['kind', 'sourceId', 'state', 'targetId'])
      .where('actorId', '=', params.actorId)
      .where('kind', 'in', params.kinds)
      .where('sourceId', 'in', sourceIds.slice(offset, offset + 300))
      .execute()
    result.push(
      ...rows.map((row) => ({
        kind: row.kind,
        sourceId: row.sourceId,
        state: row.state as AccountImportItemReference['state'],
        targetId: row.targetId
      }))
    )
  }
  return result
}

// One grouped scan over the item catalog, filtered on the (importId, state,
// position) index. Done items count by kind whatever reason a reclaimed row
// still carries; skipped and failed items count by reason code, with
// `unknown` standing in for a row that has none. Pending items are not part
// of any outcome and are left out.
export const countAccountImportItemsByOutcome = async (
  db: Db,
  params: { importId: string }
): Promise<AccountImportOutcomeReport> => {
  const rows = await db
    .selectFrom('account_import_items')
    .select((eb) => [
      'state',
      'kind',
      'reason',
      eb.fn.countAll<number>().as('count')
    ])
    .where('importId', '=', params.importId)
    .where('state', 'in', ['done', 'skipped', 'failed'])
    .groupBy(['state', 'kind', 'reason'])
    .execute()
  const report: AccountImportOutcomeReport = {
    done: {},
    skipped: {},
    failed: {}
  }
  for (const row of rows) {
    const count = Number(row.count)
    if (row.state === 'done') {
      report.done[row.kind] = (report.done[row.kind] ?? 0) + count
      continue
    }
    const reason = row.reason ?? 'unknown'
    const byReason = row.state === 'skipped' ? report.skipped : report.failed
    byReason[reason] = (byReason[reason] ?? 0) + count
  }
  return report
}

export const markAccountImportItem = async (
  db: Db,
  params: MarkAccountImportItemParams
): Promise<boolean> => {
  const values: Record<string, unknown> = {
    state: params.state,
    updatedAt: new Date()
  }
  if (
    params.state === 'done' ||
    params.state === 'skipped' ||
    (params.state === 'failed' && !params.retryable)
  ) {
    values.data = null
  }
  if (params.reason !== undefined) values.reason = params.reason
  if (params.targetId !== undefined) values.targetId = params.targetId
  const result = await db
    .updateTable('account_import_items')
    .set(values)
    .where('id', '=', params.id)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const resetRetryableAccountImportItems = async (
  db: Db,
  params: ResetRetryableAccountImportItemsParams
): Promise<number> => {
  const result = await db
    .updateTable('account_import_items')
    .set({ state: 'pending', reason: null, updatedAt: new Date() })
    .where('importId', '=', params.importId)
    .where('state', '=', 'failed')
    .where('reason', 'in', params.reasons)
    .where('data', 'is not', null)
    .executeTakeFirst()
  return Number(result.numUpdatedRows)
}

export const deleteAccountImportsForActor = async (
  db: Db,
  params: { actorId: string }
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    const importIds = (
      await trx
        .selectFrom('account_imports')
        .select('id')
        .where('actorId', '=', params.actorId)
        .execute()
    ).map((row) => row.id)
    if (importIds.length === 0) return
    await trx
      .deleteFrom('account_import_items')
      .where('importId', 'in', importIds)
      .execute()
    await trx
      .deleteFrom('account_imports')
      .where('actorId', '=', params.actorId)
      .execute()
  })
}

export const accountImportQueries = {
  createAccountImport,
  getAccountImport,
  getActiveAccountImport,
  getStaleAccountImports,
  getExpiredQueuedAccountImports,
  listAccountImports,
  countAccountImportStartsSince,
  getOldestAccountImportStartSince,
  updateAccountImport,
  claimAccountImportRun,
  renewAccountImportRun,
  releaseAccountImportRun,
  upsertAccountImportItems,
  getAccountImportItems,
  getAccountImportItemReferences,
  countAccountImportItemsByOutcome,
  markAccountImportItem,
  resetRetryableAccountImportItems,
  deleteAccountImportsForActor
}
