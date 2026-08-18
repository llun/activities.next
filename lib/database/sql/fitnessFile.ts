import crypto from 'crypto'
import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessFile,
  FitnessFileType,
  FitnessImportStatus,
  FitnessProcessingStatus,
  SQLFitnessFile
} from '@/lib/types/database/fitnessFile'

export interface CreateFitnessFileParams {
  actorId: string
  statusId?: string
  path: string
  fileName: string
  fileType: FitnessFileType
  mimeType: string
  bytes: number
  description?: string
  hasMapData?: boolean
  mapImagePath?: string
  importBatchId?: string
  sourceUrl?: string
}

export interface UpdateFitnessFileActivityData {
  totalDistanceMeters?: number | null
  totalDurationSeconds?: number | null
  movingTimeSeconds?: number | null
  elevationGainMeters?: number | null
  activityType?: string | null
  activityStartTime?: Date | null
  hasMapData?: boolean | null
  mapImagePath?: string | null
  mapImageEmailPath?: string | null
  mapError?: string | null
  deviceManufacturer?: string | null
  deviceName?: string | null
  sourceUrl?: string | null
  deviceGearId?: string | null
}

export interface GetFitnessFileParams {
  id: string
}

/**
 * A keyset pagination position: the `(createdAt, id)` of the last row of the
 * previous page. Only meaningful with `orderDirection: 'asc'`.
 */
export interface FitnessFileCursor {
  createdAt: number
  id: string
}

export interface GetFitnessFilesByActorParams {
  actorId: string
  limit?: number
  offset?: number
  processingStatus?: string
  isPrimary?: boolean
  activityType?: string | null
  startDate?: Date
  endDate?: Date
  /**
   * Newest-first by default, which is what every list surface wants. A job that
   * walks an actor's whole history uses `'asc'` with `afterCursor` so its
   * position stays valid as rows are added.
   */
  orderDirection?: 'asc' | 'desc'
  /**
   * Resume after this `(createdAt, id)` instead of counting rows with `offset`.
   * A long-running scan cannot use an offset: an upload or delete shifts every
   * row behind it, so the next page silently skips or repeats activities.
   * Ignored unless `orderDirection` is `'asc'`, since the comparison below only
   * describes a forward scan.
   */
  afterCursor?: FitnessFileCursor
}

/**
 * The same filters as a page read, minus everything that only describes how a
 * page is cut out of the result: a count is over the whole filtered set, so
 * ordering and a resume cursor would be silently ignored if they were
 * accepted.
 */
export type CountFitnessFilesByActorParams = Omit<
  GetFitnessFilesByActorParams,
  'limit' | 'offset' | 'orderDirection' | 'afterCursor'
>

export interface GetFitnessFilesByIdsParams {
  fitnessFileIds: string[]
}

export interface GetFitnessFilesForAccountParams {
  accountId: string
  limit?: number
  page?: number
  maxCreatedAt?: number
}

export interface PaginatedFitnessFiles {
  items: FitnessFile[]
  total: number
}

export interface GetFitnessFileByStatusParams {
  statusId: string
}

export interface GetFitnessFilesByBatchIdParams {
  batchId: string
}

export interface DeleteFitnessFileParams {
  id: string
}

export interface GetFitnessStorageUsageForAccountParams {
  accountId: string
}

export interface FitnessActivitySummary {
  activityType: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  totalElevationGainMeters: number
}

export interface GetFitnessActivitySummaryParams {
  actorId: string
  startDate: number
  endDate: number
}

export interface FitnessCalendarDay {
  date: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
}

export interface GetFitnessActivityCalendarDataParams {
  actorId: string
  startDate: number
  endDate: number
  activityType?: string
}

export interface GetActorHasFitnessDataParams {
  actorId: string
}

export interface FitnessFileDatabase {
  createFitnessFile(
    params: CreateFitnessFileParams
  ): Promise<FitnessFile | null>
  getFitnessFile(params: GetFitnessFileParams): Promise<FitnessFile | null>
  getFitnessFilesByIds(
    params: GetFitnessFilesByIdsParams
  ): Promise<FitnessFile[]>
  getFitnessFilesByActor(
    params: GetFitnessFilesByActorParams
  ): Promise<FitnessFile[]>
  /**
   * Counts the fitness files matching the same filters as
   * `getFitnessFilesByActor` (ignoring `limit`/`offset`). Used as the progress
   * denominator for route-heatmap generation.
   */
  countFitnessFilesByActor(
    params: CountFitnessFilesByActorParams
  ): Promise<number>
  /**
   * Returns the distinct import-batch ids the "retry all failed" action would
   * requeue for the actor: batches with a failed import, a failed map
   * processing, or a file stranded in `processing` since before `stuckBefore`.
   * One lean query (only batch-id strings) instead of paginating every file
   * row — used by the retry-all endpoint and to decide button visibility across
   * ALL of the actor's files (not just the current page).
   */
  getRetriableFitnessImportBatchIds(params: {
    actorId: string
    stuckBefore: Date
  }): Promise<string[]>
  getFitnessFilesWithStatusForAccount(
    params: GetFitnessFilesForAccountParams
  ): Promise<PaginatedFitnessFiles>
  getFitnessFileByStatus(
    params: GetFitnessFileByStatusParams
  ): Promise<FitnessFile | null>
  getFitnessFilesByBatchId(
    params: GetFitnessFilesByBatchIdParams
  ): Promise<FitnessFile[]>
  getFitnessFilesByStatus(
    params: GetFitnessFileByStatusParams
  ): Promise<FitnessFile[]>
  getFitnessStorageUsageForAccount(
    params: GetFitnessStorageUsageForAccountParams
  ): Promise<number>
  deleteFitnessFile(params: DeleteFitnessFileParams): Promise<boolean>
  updateFitnessFileStatus(
    fitnessFileId: string,
    statusId: string
  ): Promise<boolean>
  /**
   * Sets the processing state, and on `failed` records why in `importError` so
   * the reason survives the job (the settings UI renders it). `completed` and
   * `pending` clear it, so a stale message cannot outlive a successful retry.
   */
  updateFitnessFileProcessingStatus(
    fitnessFileId: string,
    processingStatus: FitnessProcessingStatus,
    processingError?: string
  ): Promise<boolean>
  updateFitnessFilesProcessingStatus(params: {
    fitnessFileIds: string[]
    processingStatus: FitnessProcessingStatus
    processingError?: string
  }): Promise<number>
  updateFitnessFileImportStatus(
    fitnessFileId: string,
    importStatus: FitnessImportStatus,
    importError?: string
  ): Promise<boolean>
  updateFitnessFilesImportStatus(params: {
    fitnessFileIds: string[]
    importStatus: FitnessImportStatus
    importError?: string
  }): Promise<number>
  updateFitnessFilePrimary(
    fitnessFileId: string,
    isPrimary: boolean
  ): Promise<boolean>
  assignFitnessFilesToImportedStatus(params: {
    fitnessFileIds: string[]
    primaryFitnessFileId: string
    statusId: string
  }): Promise<number>
  updateFitnessFileActivityData(
    fitnessFileId: string,
    data: UpdateFitnessFileActivityData
  ): Promise<boolean>
  getFitnessActivitySummary(
    params: GetFitnessActivitySummaryParams
  ): Promise<FitnessActivitySummary[]>
  getActorHasFitnessData(params: GetActorHasFitnessDataParams): Promise<boolean>
  getFitnessActivityCalendarData(
    params: GetFitnessActivityCalendarDataParams
  ): Promise<FitnessCalendarDay[]>
}

// `importError` is a text column shared by the import and processing stages. Cap
// what a job may write to it so a stack trace or a remote error body cannot
// bloat the row.
export const MAX_FITNESS_IMPORT_ERROR_LENGTH = 1000

/**
 * Every write to `importError` goes through this, so the cap cannot be bypassed
 * by whichever setter happens to land last: the import and processing stages
 * both write the column, and a reason longer than the cap would otherwise be
 * stored truncated by one and in full by the other.
 */
const truncateImportError = (importError: string) =>
  importError.slice(0, MAX_FITNESS_IMPORT_ERROR_LENGTH)

/**
 * Builds the row update for a processing-status write, keeping `importError` in
 * step so the two can never disagree:
 *
 * - `failed` WITH a reason records it (truncated).
 * - `failed` WITHOUT one leaves the column alone. `markImportFileFailed` writes
 *   the reason through `updateFitnessFileImportStatus` concurrently with this
 *   call, so clearing here would race it and wipe the reason.
 * - `completed`/`pending` clear it, so a stale message cannot outlive a retry.
 *
 * Callers that set `failed` should always pass a reason; `pending` callers that
 * may need to roll back must capture `importError` first and pass it back.
 */
const buildProcessingStatusUpdate = (
  processingStatus: FitnessProcessingStatus,
  processingError?: string
): Record<string, unknown> => {
  const updateData: Record<string, unknown> = {
    processingStatus,
    updatedAt: new Date()
  }

  if (processingStatus === 'failed') {
    if (processingError) {
      updateData.importError = truncateImportError(processingError)
    }
    return updateData
  }

  if (processingStatus === 'completed' || processingStatus === 'pending') {
    updateData.importError = null
  }

  return updateData
}

// Helper function to normalize bytes from database which can be number, string, or bigint
const normalizeBytes = (bytes: number | string | bigint): number => {
  return Number(bytes)
}

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

const parseSQLFitnessFile = (row: SQLFitnessFile): FitnessFile => ({
  id: row.id,
  actorId: row.actorId,
  statusId: row.statusId ?? undefined,
  path: row.path,
  fileName: row.fileName,
  fileType: row.fileType,
  mimeType: row.mimeType,
  bytes: normalizeBytes(row.bytes),
  description: row.description ?? undefined,
  hasMapData: Boolean(row.hasMapData),
  mapImagePath: row.mapImagePath ?? undefined,
  mapImageEmailPath: row.mapImageEmailPath ?? undefined,
  mapError: row.mapError ?? undefined,
  processingStatus: row.processingStatus ?? 'pending',
  isPrimary:
    row.isPrimary === null || row.isPrimary === undefined
      ? true
      : Boolean(row.isPrimary),
  importBatchId: row.importBatchId ?? undefined,
  importStatus: row.importStatus ?? undefined,
  importError: row.importError ?? undefined,
  totalDistanceMeters: normalizeOptionalNumber(row.totalDistanceMeters),
  totalDurationSeconds: normalizeOptionalNumber(row.totalDurationSeconds),
  movingTimeSeconds: normalizeOptionalNumber(row.movingTimeSeconds),
  elevationGainMeters: normalizeOptionalNumber(row.elevationGainMeters),
  activityType: row.activityType ?? undefined,
  deviceManufacturer: row.deviceManufacturer ?? undefined,
  deviceName: row.deviceName ?? undefined,
  sourceUrl: row.sourceUrl ?? undefined,
  gearId: row.gearId ?? undefined,
  deviceGearId: row.deviceGearId ?? undefined,
  activityStartTime: row.activityStartTime
    ? getCompatibleTime(row.activityStartTime)
    : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const FitnessFileSQLDatabaseMixin = (
  database: Knex
): FitnessFileDatabase => ({
  async createFitnessFile(params: CreateFitnessFileParams) {
    return database.transaction(async (trx) => {
      const actor = await trx('actors')
        .where('id', params.actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const currentTime = new Date()
      const id = crypto.randomUUID()

      const data: SQLFitnessFile = {
        id,
        actorId: params.actorId,
        statusId: params.statusId ?? null,
        path: params.path,
        fileName: params.fileName,
        fileType: params.fileType,
        mimeType: params.mimeType,
        bytes: params.bytes,
        description: params.description ?? null,
        hasMapData: params.hasMapData ?? false,
        mapImagePath: params.mapImagePath ?? null,
        // Only ever written by the import job, once the map exists.
        mapImageEmailPath: null,
        isPrimary: true,
        importBatchId: params.importBatchId ?? null,
        importStatus: params.importBatchId ? 'pending' : null,
        importError: null,
        processingStatus: 'pending',
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        movingTimeSeconds: null,
        elevationGainMeters: null,
        activityType: null,
        activityStartTime: null,
        sourceUrl: params.sourceUrl ?? null,
        // Attribution happens after parsing (auto-assign by default sport) or
        // on import from Strava's own gear id — never at upload time.
        gearId: null,
        createdAt: currentTime,
        updatedAt: currentTime
      }

      await trx('fitness_files').insert(data)

      // Update counters
      if (actor?.accountId) {
        await increaseCounterValue(
          trx,
          CounterKey.fitnessUsage(actor.accountId),
          params.bytes
        )
        await increaseCounterValue(
          trx,
          CounterKey.totalFitness(actor.accountId),
          1
        )
      }
      await incrementBucket(trx, 'fitness-files', 1)
      if (params.bytes > 0) {
        await incrementBucket(trx, 'fitness-bytes', params.bytes)
      }

      return parseSQLFitnessFile(data)
    })
  },

  async getFitnessFile({ id }: GetFitnessFileParams) {
    const row = await database<SQLFitnessFile>('fitness_files')
      .where('id', id)
      .whereNull('deletedAt')
      .first()

    if (!row) return null
    return parseSQLFitnessFile(row)
  },

  async getFitnessFilesByIds({ fitnessFileIds }: GetFitnessFilesByIdsParams) {
    if (fitnessFileIds.length === 0) {
      return []
    }

    const rows = await database<SQLFitnessFile>('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')

    const fileById = new Map(
      rows.map((row) => [row.id, parseSQLFitnessFile(row)])
    )

    return fitnessFileIds
      .map((fitnessFileId) => fileById.get(fitnessFileId))
      .filter((item): item is FitnessFile => Boolean(item))
  },

  async getFitnessFilesByActor({
    actorId,
    limit = 25,
    offset = 0,
    processingStatus,
    isPrimary,
    activityType,
    startDate,
    endDate,
    orderDirection = 'desc',
    afterCursor
  }: GetFitnessFilesByActorParams) {
    let query = database<SQLFitnessFile>('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')

    if (processingStatus) {
      query = query.where('processingStatus', processingStatus)
    }
    if (isPrimary !== undefined) {
      query = query.where('isPrimary', isPrimary)
    }
    if (activityType !== undefined) {
      if (activityType === null) {
        query = query.whereNull('activityType')
      } else {
        query = query.where('activityType', activityType)
      }
    }
    if (startDate) {
      query = query.where('activityStartTime', '>=', startDate)
    }
    if (endDate) {
      query = query.where('activityStartTime', '<=', endDate)
    }

    if (afterCursor && orderDirection === 'asc') {
      // Strictly after (createdAt, id) in the sort's own order, written as a
      // nested OR rather than a row-value comparison because SQLite, MySQL and
      // PostgreSQL do not agree on `(a, b) > (?, ?)`.
      const { createdAt, id } = afterCursor
      const cursorTime = new Date(createdAt)
      query = query.where((cursor) =>
        cursor
          .where('createdAt', '>', cursorTime)
          .orWhere((tie) =>
            tie.where('createdAt', cursorTime).where('id', '>', id)
          )
      )
    }

    const rows = await query
      .orderBy('createdAt', orderDirection)
      .orderBy('id', orderDirection)
      .limit(limit)
      .offset(offset)

    return rows.map(parseSQLFitnessFile)
  },

  async countFitnessFilesByActor({
    actorId,
    processingStatus,
    isPrimary,
    activityType,
    startDate,
    endDate
  }: CountFitnessFilesByActorParams) {
    let query = database<SQLFitnessFile>('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')

    if (processingStatus) {
      query = query.where('processingStatus', processingStatus)
    }
    if (isPrimary !== undefined) {
      query = query.where('isPrimary', isPrimary)
    }
    if (activityType !== undefined) {
      if (activityType === null) {
        query = query.whereNull('activityType')
      } else {
        query = query.where('activityType', activityType)
      }
    }
    if (startDate) {
      query = query.where('activityStartTime', '>=', startDate)
    }
    if (endDate) {
      query = query.where('activityStartTime', '<=', endDate)
    }

    const [row] = await query.count<{ count: string | number }[]>({
      count: '*'
    })

    return Number(row?.count ?? 0)
  },

  async getRetriableFitnessImportBatchIds({
    actorId,
    stuckBefore
  }: {
    actorId: string
    stuckBefore: Date
  }) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .whereNotNull('importBatchId')
      .where((builder) => {
        builder
          .where('importStatus', 'failed')
          .orWhere('processingStatus', 'failed')
          .orWhere((stuck) => {
            stuck
              .where('processingStatus', 'processing')
              .where('updatedAt', '<=', stuckBefore)
          })
          // A SIGABRT/OOM crashes the importer before its catch can write
          // 'failed', stranding the file at importStatus='pending' with no
          // statusId (see isFitnessImportStuck). Those orphans are retriable too.
          .orWhere((stuckImport) => {
            stuckImport
              .where('importStatus', 'pending')
              .whereNull('statusId')
              .where('updatedAt', '<=', stuckBefore)
          })
      })
      .distinct('importBatchId')

    return rows
      .map((row) => row.importBatchId)
      .filter((batchId): batchId is string => Boolean(batchId))
  },

  async getFitnessFilesWithStatusForAccount({
    accountId,
    limit = 100,
    page = 1,
    maxCreatedAt
  }: GetFitnessFilesForAccountParams): Promise<PaginatedFitnessFiles> {
    // Get total count from counter table for performance.
    const totalPromise = getCounterValue(
      database,
      CounterKey.totalFitness(accountId)
    )

    let itemsQuery = database<SQLFitnessFile>('fitness_files')
      .join('actors', 'fitness_files.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .whereNull('fitness_files.deletedAt')
      .select('fitness_files.*')
      .orderBy('fitness_files.createdAt', 'desc')

    if (maxCreatedAt) {
      itemsQuery = itemsQuery.where(
        'fitness_files.createdAt',
        '<',
        new Date(maxCreatedAt)
      )
    }

    const offset = (page - 1) * limit
    itemsQuery = itemsQuery.limit(limit).offset(offset)

    const [total, rows] = await Promise.all([totalPromise, itemsQuery])

    return {
      items: rows.map(parseSQLFitnessFile),
      total
    }
  },

  async getFitnessFileByStatus({ statusId }: GetFitnessFileByStatusParams) {
    const row = await database<SQLFitnessFile>('fitness_files')
      .where('statusId', statusId)
      .whereNull('deletedAt')
      .orderBy('isPrimary', 'desc')
      .orderBy('activityStartTime', 'asc')
      .orderBy('createdAt', 'asc')
      .first()

    if (!row) return null
    return parseSQLFitnessFile(row)
  },

  async getFitnessFilesByBatchId({ batchId }: GetFitnessFilesByBatchIdParams) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('importBatchId', batchId)
      .whereNull('deletedAt')
      .orderBy('createdAt', 'asc')

    return rows.map(parseSQLFitnessFile)
  },

  async getFitnessFilesByStatus({ statusId }: GetFitnessFileByStatusParams) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('statusId', statusId)
      .whereNull('deletedAt')
      .orderBy('isPrimary', 'desc')
      .orderBy('activityStartTime', 'asc')
      .orderBy('createdAt', 'asc')

    return rows.map(parseSQLFitnessFile)
  },

  async getFitnessStorageUsageForAccount({
    accountId
  }: GetFitnessStorageUsageForAccountParams): Promise<number> {
    return getCounterValue(database, CounterKey.fitnessUsage(accountId))
  },

  async deleteFitnessFile({ id }: DeleteFitnessFileParams) {
    return database.transaction(async (trx) => {
      const file = await trx<SQLFitnessFile>('fitness_files')
        .where('id', id)
        .whereNull('deletedAt')
        .first()

      if (!file) return false

      const actor = await trx('actors')
        .where('id', file.actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const currentTime = new Date()
      await trx('fitness_files').where('id', id).update({
        deletedAt: currentTime,
        updatedAt: currentTime
      })

      // Drop the cached route with the activity. Every aggregate over
      // `fitness_file_routes` already joins through this soft delete, so a
      // leftover row would never be counted — but it would hold the whole
      // polyline forever, and that blob is the bulk of what the cache costs.
      // Written against `trx` rather than through the route mixin because that
      // mixin is bound to the non-transactional handle; the delete has to land
      // or roll back with the soft delete itself. Losing it is safe either way:
      // the row is a cache of the source file, re-derived on the next miss.
      await trx('fitness_file_routes').where('fitnessFileId', id).delete()

      // Update counters
      const bytes = normalizeBytes(file.bytes)
      if (actor?.accountId) {
        await decreaseCounterValue(
          trx,
          CounterKey.fitnessUsage(actor.accountId),
          bytes
        )
        await decreaseCounterValue(
          trx,
          CounterKey.totalFitness(actor.accountId),
          1
        )
      }

      return true
    })
  },

  async updateFitnessFileStatus(fitnessFileId: string, statusId: string) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        statusId,
        updatedAt: new Date()
      })

    return result > 0
  },

  async updateFitnessFileProcessingStatus(
    fitnessFileId: string,
    processingStatus: FitnessProcessingStatus,
    processingError?: string
  ) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update(buildProcessingStatusUpdate(processingStatus, processingError))

    return result > 0
  },

  async updateFitnessFilesProcessingStatus({
    fitnessFileIds,
    processingStatus,
    processingError
  }: {
    fitnessFileIds: string[]
    processingStatus: FitnessProcessingStatus
    processingError?: string
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update(buildProcessingStatusUpdate(processingStatus, processingError))
  },

  async updateFitnessFileImportStatus(
    fitnessFileId: string,
    importStatus: FitnessImportStatus,
    importError?: string
  ) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        importStatus,
        importError: importError ? truncateImportError(importError) : null,
        updatedAt: new Date()
      })

    return result > 0
  },

  async updateFitnessFilesImportStatus({
    fitnessFileIds,
    importStatus,
    importError
  }: {
    fitnessFileIds: string[]
    importStatus: FitnessImportStatus
    importError?: string
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update({
        importStatus,
        importError: importError ? truncateImportError(importError) : null,
        updatedAt: new Date()
      })
  },

  async updateFitnessFilePrimary(fitnessFileId: string, isPrimary: boolean) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        isPrimary,
        updatedAt: new Date()
      })

    return result > 0
  },

  async assignFitnessFilesToImportedStatus({
    fitnessFileIds,
    primaryFitnessFileId,
    statusId
  }: {
    fitnessFileIds: string[]
    primaryFitnessFileId: string
    statusId: string
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update({
        statusId,
        importStatus: 'completed',
        importError: null,
        isPrimary: database.raw('CASE WHEN id = ? THEN TRUE ELSE FALSE END', [
          primaryFitnessFileId
        ]),
        processingStatus: database.raw('CASE WHEN id = ? THEN ? ELSE ? END', [
          primaryFitnessFileId,
          'pending',
          'completed'
        ]),
        updatedAt: new Date()
      })
  },

  async updateFitnessFileActivityData(
    fitnessFileId: string,
    data: UpdateFitnessFileActivityData
  ) {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    }

    const numberFields: Array<
      keyof Pick<
        UpdateFitnessFileActivityData,
        | 'totalDistanceMeters'
        | 'totalDurationSeconds'
        | 'movingTimeSeconds'
        | 'elevationGainMeters'
      >
    > = [
      'totalDistanceMeters',
      'totalDurationSeconds',
      'movingTimeSeconds',
      'elevationGainMeters'
    ]

    for (const field of numberFields) {
      if (!(field in data)) continue
      const value = data[field]
      updateData[field] = typeof value === 'number' ? value : null
    }
    if ('activityType' in data) {
      updateData.activityType = data.activityType ?? null
    }
    if ('activityStartTime' in data) {
      updateData.activityStartTime = data.activityStartTime ?? null
    }
    if ('hasMapData' in data) {
      updateData.hasMapData = data.hasMapData ?? false
    }
    if ('mapImagePath' in data) {
      updateData.mapImagePath = data.mapImagePath ?? null
    }
    if ('mapImageEmailPath' in data) {
      updateData.mapImageEmailPath = data.mapImageEmailPath ?? null
    }
    if ('mapError' in data) {
      // Shares `importError`'s cap: both are operator/owner-facing reasons
      // written from a thrown value, so an unbounded message is the same insert
      // hazard here as there.
      updateData.mapError = data.mapError
        ? truncateImportError(data.mapError)
        : null
    }
    if ('deviceManufacturer' in data) {
      updateData.deviceManufacturer = data.deviceManufacturer ?? null
    }
    if ('deviceName' in data) {
      updateData.deviceName = data.deviceName ?? null
    }
    if ('sourceUrl' in data) {
      updateData.sourceUrl = data.sourceUrl ?? null
    }
    if ('deviceGearId' in data) {
      updateData.deviceGearId = data.deviceGearId ?? null
    }

    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update(updateData)

    return result > 0
  },

  async getFitnessActivitySummary({
    actorId,
    startDate,
    endDate
  }: GetFitnessActivitySummaryParams): Promise<FitnessActivitySummary[]> {
    const rows = await database('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .where('processingStatus', 'completed')
      .where('isPrimary', true)
      .whereNotNull('activityType')
      .whereNotNull('activityStartTime')
      .where('activityStartTime', '>=', new Date(startDate))
      .where('activityStartTime', '<', new Date(endDate))
      .groupBy('activityType')
      .select(
        'activityType',
        database.raw('COUNT(*) as count'),
        ...(
          [
            ['totalDistanceMeters', 'totalDistanceMeters'],
            ['totalDurationSeconds', 'totalDurationSeconds'],
            ['elevationGainMeters', 'totalElevationGainMeters']
          ] as [string, string][]
        ).map(([col, alias]) =>
          database.raw('COALESCE(SUM(??), 0) as ??', [col, alias])
        )
      )

    return rows.map((row: Record<string, unknown>) => ({
      activityType: String(row.activityType),
      count: Number(row.count),
      totalDistanceMeters: Number(row.totalDistanceMeters),
      totalDurationSeconds: Number(row.totalDurationSeconds),
      totalElevationGainMeters: Number(row.totalElevationGainMeters)
    }))
  },

  async getActorHasFitnessData({ actorId }: GetActorHasFitnessDataParams) {
    const row = await database('fitness_files')
      .where('actorId', actorId)
      .where('processingStatus', 'completed')
      .where('isPrimary', true)
      .whereNull('deletedAt')
      .whereNotNull('activityType')
      .whereNotNull('activityStartTime')
      .select(database.raw('1'))
      .first()
    return Boolean(row)
  },

  async getFitnessActivityCalendarData({
    actorId,
    startDate,
    endDate,
    activityType
  }: GetFitnessActivityCalendarDataParams): Promise<FitnessCalendarDay[]> {
    let query = database('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .where('processingStatus', 'completed')
      .where('isPrimary', true)
      .whereNotNull('activityStartTime')
      .where('activityStartTime', '>=', new Date(startDate))
      .where('activityStartTime', '<', new Date(endDate))

    if (activityType) {
      query = query.where('activityType', activityType)
    }

    const client = String(database.client.config.client)
    const isSQLite = client === 'better-sqlite3' || client === 'sqlite3'
    const dateExpr = isSQLite
      ? database.raw("DATE(?? / 1000, 'unixepoch')", ['activityStartTime'])
      : database.raw("DATE(?? AT TIME ZONE 'UTC')", ['activityStartTime'])
    const dateSelectExpr = isSQLite
      ? database.raw("DATE(?? / 1000, 'unixepoch') as ??", [
          'activityStartTime',
          'date'
        ])
      : database.raw(
          "TO_CHAR(DATE(?? AT TIME ZONE 'UTC'), 'YYYY-MM-DD') as ??",
          ['activityStartTime', 'date']
        )

    const rows = await query
      .groupBy(dateExpr)
      .select(
        dateSelectExpr,
        database.raw('COUNT(*) as count'),
        ...(
          [
            ['totalDistanceMeters', 'totalDistanceMeters'],
            ['totalDurationSeconds', 'totalDurationSeconds']
          ] as [string, string][]
        ).map(([col, alias]) =>
          database.raw('COALESCE(SUM(??), 0) as ??', [col, alias])
        )
      )
      .orderBy('date', 'asc')

    return rows.map((row: Record<string, unknown>) => ({
      date: String(row.date),
      count: Number(row.count),
      totalDistanceMeters: Number(row.totalDistanceMeters),
      totalDurationSeconds: Number(row.totalDurationSeconds)
    }))
  }
})
