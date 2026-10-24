import type { Selectable, Updateable } from 'kysely'

import type {
  BulkImport,
  BulkImportRow,
  BulkImportRowState,
  BulkImportState,
  ClaimBulkImportRunParams,
  ClaimBulkImportRunResult,
  CreateBulkImportParams,
  GetBulkImportByIdParams,
  GetBulkImportFailedRowsParams,
  GetBulkImportParams,
  GetBulkImportRowsParams,
  GetBulkImportsParams,
  MarkBulkImportRowProcessedParams,
  ReleaseBulkImportRunParams,
  UpdateBulkImportParams,
  UpdateBulkImportRowDataParams
} from '@/lib/database/domains/bulkImport/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { BulkImportRows, BulkImports } from '@/lib/database/kysely/db'
import { forUpdate, timestampValue } from '@/lib/database/kysely/dialect'
import { BULK_IMPORT_STALE_MS } from '@/lib/services/imports/types'
import type {
  BulkImportRowData,
  BulkImportType
} from '@/lib/services/imports/types'

export const getBulkImportRowId = (
  importId: string,
  rowIndex: number
): string => `${importId}:${rowIndex}`

const toBulkImport = (row: Selectable<BulkImports>): BulkImport => ({
  id: row.id,
  actorId: row.actorId,
  type: row.type as BulkImportType,
  overwrite: Boolean(row.overwrite),
  state: row.state as BulkImportState,
  originalFilename: row.originalFilename,
  totalItems: row.totalItems,
  processedItems: row.processedItems,
  importedItems: row.importedItems,
  overwriteDone: Boolean(row.overwriteDone),
  nextRowIndex: row.nextRowIndex,
  overwriteProgress: row.overwriteProgress,
  listsPrepared: Boolean(row.listsPrepared),
  lastError: row.lastError ?? null,
  finishedAt: row.finishedAt ? new Date(row.finishedAt).getTime() : null,
  createdAt: new Date(row.createdAt).getTime(),
  updatedAt: new Date(row.updatedAt).getTime()
})

const toBulkImportRow = (row: Selectable<BulkImportRows>): BulkImportRow => ({
  id: row.id,
  importId: row.importId,
  rowIndex: row.rowIndex,
  data: JSON.parse(row.data) as BulkImportRowData,
  state: row.state as BulkImportRowState,
  error: row.error ?? null
})

export const createBulkImport = async (
  db: Db,
  params: CreateBulkImportParams
): Promise<BulkImport | null> => {
  return await inTransaction(db, async (trx) => {
    await forUpdate(
      trx,
      trx.selectFrom('actors').select('id').where('id', '=', params.actorId)
    ).executeTakeFirst()

    const now = new Date()

    // A job that died for good never finishes its import; free the actor.
    await trx
      .updateTable('bulk_imports')
      .set({
        state: 'finished',
        lastError: 'Abandoned: no progress for 24 hours',
        finishedAt: now,
        updatedAt: now
      })
      .where('actorId', '=', params.actorId)
      .where('state', '!=', 'finished')
      .where(
        'updatedAt',
        '<',
        timestampValue(now.getTime() - BULK_IMPORT_STALE_MS)
      )
      .execute()

    const existing = await trx
      .selectFrom('bulk_imports')
      .select('id')
      .where('actorId', '=', params.actorId)
      .where('state', '!=', 'finished')
      .executeTakeFirst()

    if (existing) {
      return null
    }

    await trx
      .insertInto('bulk_imports')
      .values({
        id: params.id,
        actorId: params.actorId,
        type: params.type,
        overwrite: params.overwrite,
        state: 'scheduled',
        originalFilename: params.originalFilename,
        totalItems: params.rows.length,
        processedItems: 0,
        importedItems: 0,
        overwriteDone: false,
        nextRowIndex: 0,
        overwriteProgress: 0,
        listsPrepared: false,
        runToken: null,
        claimedUntil: null,
        lastError: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now
      })
      .execute()

    const CHUNK_SIZE = 100
    for (let i = 0; i < params.rows.length; i += CHUNK_SIZE) {
      const chunk = params.rows.slice(i, i + CHUNK_SIZE)
      const values = chunk.map((row, index) => {
        const rowIndex = i + index
        return {
          id: getBulkImportRowId(params.id, rowIndex),
          importId: params.id,
          rowIndex,
          data: JSON.stringify(row),
          state: 'pending',
          error: null,
          createdAt: now,
          updatedAt: now
        }
      })
      if (values.length > 0) {
        await trx.insertInto('bulk_import_rows').values(values).execute()
      }
    }

    const created = await trx
      .selectFrom('bulk_imports')
      .selectAll()
      .where('id', '=', params.id)
      .executeTakeFirstOrThrow()

    return toBulkImport(created)
  })
}

export const getBulkImport = async (
  db: Db,
  params: GetBulkImportParams
): Promise<BulkImport | null> => {
  const row = await db
    .selectFrom('bulk_imports')
    .selectAll()
    .where('id', '=', params.id)
    .where('actorId', '=', params.actorId)
    .executeTakeFirst()

  return row ? toBulkImport(row) : null
}

export const getBulkImportById = async (
  db: Db,
  params: GetBulkImportByIdParams
): Promise<BulkImport | null> => {
  const row = await db
    .selectFrom('bulk_imports')
    .selectAll()
    .where('id', '=', params.id)
    .executeTakeFirst()

  return row ? toBulkImport(row) : null
}

export const getBulkImports = async (
  db: Db,
  params: GetBulkImportsParams
): Promise<BulkImport[]> => {
  let query = db
    .selectFrom('bulk_imports')
    .selectAll()
    .where('actorId', '=', params.actorId)
    .orderBy('createdAt', 'desc')

  if (params.limit !== undefined) {
    query = query.limit(params.limit)
  }

  const rows = await query.execute()
  return rows.map(toBulkImport)
}

export const getBulkImportRows = async (
  db: Db,
  params: GetBulkImportRowsParams
): Promise<BulkImportRow[]> => {
  let query = db
    .selectFrom('bulk_import_rows')
    .selectAll()
    .where('importId', '=', params.importId)
    .where('rowIndex', '>=', params.fromRowIndex)

  if (params.state !== undefined) {
    query = query.where('state', '=', params.state)
  }

  const rows = await query
    .orderBy('rowIndex', 'asc')
    .limit(params.limit)
    .execute()

  return rows.map(toBulkImportRow)
}

export const markBulkImportRowProcessed = async (
  db: Db,
  params: MarkBulkImportRowProcessedParams
): Promise<boolean> => {
  return await inTransaction(db, async (trx) => {
    const updateResult = await trx
      .updateTable('bulk_import_rows')
      .set({
        state: params.imported ? 'imported' : 'failed',
        error: params.error ?? null,
        updatedAt: new Date()
      })
      .where('id', '=', params.rowId)
      .where('importId', '=', params.importId)
      .where('state', '=', 'pending')
      .executeTakeFirst()

    const updatedCount = Number(updateResult.numUpdatedRows ?? 0n)
    if (updatedCount === 0) {
      return false
    }

    await trx
      .updateTable('bulk_imports')
      .set((eb) => ({
        processedItems: eb('processedItems', '+', 1),
        ...(params.imported
          ? { importedItems: eb('importedItems', '+', 1) }
          : {}),
        updatedAt: new Date()
      }))
      .where('id', '=', params.importId)
      .execute()

    const current = await trx
      .selectFrom('bulk_imports')
      .select(['processedItems', 'totalItems'])
      .where('id', '=', params.importId)
      .executeTakeFirst()

    if (current && current.processedItems >= current.totalItems) {
      const now = new Date()
      await trx
        .updateTable('bulk_imports')
        .set({
          state: 'finished',
          finishedAt: now,
          updatedAt: now
        })
        .where('id', '=', params.importId)
        .execute()
    }

    return true
  })
}

export const updateBulkImport = async (
  db: Db,
  params: UpdateBulkImportParams
): Promise<void> => {
  const updateData: Updateable<BulkImports> = {
    updatedAt: new Date()
  }

  if (params.state !== undefined) {
    updateData.state = params.state
  }
  if (params.nextRowIndex !== undefined) {
    updateData.nextRowIndex = params.nextRowIndex
  }
  if (params.overwriteDone !== undefined) {
    updateData.overwriteDone = params.overwriteDone
  }
  if (params.overwriteProgress !== undefined) {
    updateData.overwriteProgress = params.overwriteProgress
  }
  if (params.listsPrepared !== undefined) {
    updateData.listsPrepared = params.listsPrepared
  }
  if (params.lastError !== undefined) {
    updateData.lastError = params.lastError
  }
  if (params.finishedAt !== undefined) {
    updateData.finishedAt =
      params.finishedAt === null ? null : new Date(params.finishedAt)
  }

  await db
    .updateTable('bulk_imports')
    .set(updateData)
    .where('id', '=', params.id)
    .execute()
}

export const updateBulkImportRowData = async (
  db: Db,
  params: UpdateBulkImportRowDataParams
): Promise<void> => {
  await db
    .updateTable('bulk_import_rows')
    .set({ data: JSON.stringify(params.data), updatedAt: new Date() })
    .where('id', '=', params.rowId)
    .where('importId', '=', params.importId)
    .execute()
}

// Takes the import for one run. Only one run at a time may work on an import:
// a redelivered or retried job would otherwise process the same rows twice. The
// lease lapses by itself, so a run that died never blocks the import for good.
export const claimBulkImportRun = async (
  db: Db,
  params: ClaimBulkImportRunParams
): Promise<ClaimBulkImportRunResult> => {
  const now = Date.now()
  const result = await db
    .updateTable('bulk_imports')
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

  if (Number(result.numUpdatedRows ?? 0n) > 0) return { claimed: true }

  const current = await db
    .selectFrom('bulk_imports')
    .select('claimedUntil')
    .where('id', '=', params.id)
    .executeTakeFirst()
  return {
    claimed: false,
    claimedUntil: current?.claimedUntil
      ? new Date(current.claimedUntil).getTime()
      : null
  }
}

// Only clears a claim this run still holds; a lapsed one may already be
// another run's.
export const releaseBulkImportRun = async (
  db: Db,
  params: ReleaseBulkImportRunParams
): Promise<void> => {
  await db
    .updateTable('bulk_imports')
    .set({ runToken: null, claimedUntil: null })
    .where('id', '=', params.id)
    .where('runToken', '=', params.runToken)
    .execute()
}

export const getBulkImportFailedRows = async (
  db: Db,
  params: GetBulkImportFailedRowsParams
): Promise<BulkImportRow[]> => {
  let query = db
    .selectFrom('bulk_import_rows')
    .selectAll()
    .where('importId', '=', params.importId)
    .where('state', '=', 'failed')
    .orderBy('rowIndex', 'asc')

  if (params.limit !== undefined) {
    query = query.limit(params.limit)
  }

  const rows = await query.execute()
  return rows.map(toBulkImportRow)
}

export const bulkImportQueries = {
  createBulkImport,
  getBulkImport,
  getBulkImportById,
  getBulkImports,
  getBulkImportRows,
  markBulkImportRowProcessed,
  updateBulkImport,
  updateBulkImportRowData,
  claimBulkImportRun,
  releaseBulkImportRun,
  getBulkImportFailedRows
}
