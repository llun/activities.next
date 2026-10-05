import crypto from 'crypto'
import { Knex } from 'knex'

import { buildActorVisibleStatusIdsQuery } from '@/lib/database/sql/status'
import { applyCountableActivityFilter } from '@/lib/database/sql/utils/countableActivity'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  bucketByLocalDay,
  isValidTimeZone
} from '@/lib/fitness/calendar/localDay'
import type {
  FitnessActivitySummary,
  FitnessActivityTimeBounds,
  FitnessCalendarDay,
  FitnessWindowActivity,
  FitnessWindowActivityPage
} from '@/lib/fitness/calendar/types'
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
  avgPower?: number | null
  maxPower?: number | null
  avgHeartRate?: number | null
  maxHeartRate?: number | null
  totalWorkKj?: number | null
  elevationSeries?: string | number[] | null
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

export type {
  FitnessActivitySummary,
  FitnessActivityTimeBounds,
  FitnessCalendarDay,
  FitnessWindowActivity,
  FitnessWindowActivityPage
}

/**
 * The instant window `[startDate, endDate)` in epoch milliseconds. Callers
 * build it from local dates with `localDayWindow`, so the database never sees a
 * time zone for a range filter and the filter reads the same on every backend.
 */
export interface GetFitnessActivitySummaryParams {
  actorId: string
  startDate: number
  endDate: number
}

export interface GetFitnessActivityCalendarDataParams {
  actorId: string
  /** Inclusive start of the window, epoch milliseconds. */
  startDate: number
  /** Exclusive end of the window, epoch milliseconds. */
  endDate: number
  /** IANA zone the days are bucketed in; the same one that built the window. */
  timeZone: string
  activityType?: string
}

export interface GetFitnessActivitiesInWindowParams {
  actorId: string
  /** Inclusive start of the window, epoch milliseconds. */
  startDate: number
  /** Exclusive end of the window, epoch milliseconds. */
  endDate: number
  limit: number
  offset: number
}

export interface GetFitnessActivityTimeBoundsParams {
  actorId: string
}

export interface GetActorHasFitnessDataParams {
  actorId: string
  /**
   * The audience the answer is for, in the shape `getActorStatuses` takes. With
   * none of these set the query is unscoped, which is the owner's own view
   * (their fitness pages gate on it). Anyone else must pass their audience: a
   * fitness file whose status the viewer cannot read is not data that viewer
   * may learn exists, so only files attached to a status in the audience count.
   */
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
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
  /**
   * Per-local-day totals for the window, ascending by date. Days without a
   * countable activity are absent.
   */
  getFitnessActivityCalendarData(
    params: GetFitnessActivityCalendarDataParams
  ): Promise<FitnessCalendarDay[]>
  /**
   * The activities behind the calendar for a window, oldest first (ties by id),
   * one page at a time. It applies the same predicate as the summary and the
   * calendar, so a day's rows always add up to that day's calendar entry.
   */
  getFitnessActivitiesInWindow(
    params: GetFitnessActivitiesInWindowParams
  ): Promise<FitnessWindowActivityPage>
  /** The earliest countable activity, under the same predicate. */
  getFitnessActivityTimeBounds(
    params: GetFitnessActivityTimeBoundsParams
  ): Promise<FitnessActivityTimeBounds>
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

export const parseElevationSeries = (
  value: string | null | undefined
): number[] | undefined => {
  if (!value) return undefined
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (Array.isArray(parsed)) {
      return parsed.map(Number).filter(Number.isFinite)
    }
  } catch {
    return undefined
  }
  return undefined
}

// Defensive ceiling for one page of `getFitnessActivitiesInWindow`; the route
// clamps lower, this only stops a caller asking for an unbounded page.
const MAX_WINDOW_PAGE_SIZE = 100

/**
 * The one predicate behind the fitness overview's summary, calendar and day
 * details: the actor's countable activities (primary, completed, not deleted)
 * that started in the half-open instant window `[startDate, endDate)`.
 *
 * It is deliberately the only place the three reads get their rows from, so a
 * day's calendar entry, that day's details and the summary can never disagree
 * about what counts. The range is a plain comparison on `activityStartTime`, with
 * no date function and no time zone, so it behaves the same on SQLite (epoch
 * milliseconds) and PostgreSQL (`timestamptz`).
 */
const countableActivitiesInWindow = (
  database: Knex,
  {
    actorId,
    startDate,
    endDate
  }: { actorId: string; startDate: number; endDate: number }
) =>
  applyCountableActivityFilter(
    database,
    database('fitness_files'),
    'fitness_files'
  )
    .where('fitness_files.actorId', actorId)
    .whereNotNull('fitness_files.activityStartTime')
    .where('fitness_files.activityStartTime', '>=', new Date(startDate))
    .where('fitness_files.activityStartTime', '<', new Date(endDate))

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
  avgPower: normalizeOptionalNumber(row.avgPower),
  maxPower: normalizeOptionalNumber(row.maxPower),
  avgHeartRate: normalizeOptionalNumber(row.avgHeartRate),
  maxHeartRate: normalizeOptionalNumber(row.maxHeartRate),
  totalWorkKj: normalizeOptionalNumber(row.totalWorkKj),
  elevationSeries: parseElevationSeries(row.elevationSeries),
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

const buildFitnessFilesByActorQuery = (
  database: Knex,
  params: CountFitnessFilesByActorParams
): Knex.QueryBuilder<SQLFitnessFile> => {
  const {
    actorId,
    processingStatus,
    isPrimary,
    activityType,
    startDate,
    endDate
  } = params

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

  return query
}

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
        // Attribution happens after parsing, from the gear whose default sports
        // claim the parsed one — never at upload time, and never from an
        // import's own record of the gear (see AGENTS.md → Fitness Gear).
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

  async getFitnessFilesByActor(params: GetFitnessFilesByActorParams) {
    const {
      limit = 25,
      offset = 0,
      orderDirection = 'desc',
      afterCursor
    } = params

    let query = buildFitnessFilesByActorQuery(database, params)

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

  async countFitnessFilesByActor(params: CountFitnessFilesByActorParams) {
    const query = buildFitnessFilesByActorQuery(database, params)

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
        | 'avgPower'
        | 'maxPower'
        | 'avgHeartRate'
        | 'maxHeartRate'
        | 'totalWorkKj'
      >
    > = [
      'totalDistanceMeters',
      'totalDurationSeconds',
      'movingTimeSeconds',
      'elevationGainMeters',
      'avgPower',
      'maxPower',
      'avgHeartRate',
      'maxHeartRate',
      'totalWorkKj'
    ]

    for (const field of numberFields) {
      if (!(field in data)) continue
      const value = data[field]
      updateData[field] = typeof value === 'number' ? value : null
    }
    if ('elevationSeries' in data) {
      if (Array.isArray(data.elevationSeries)) {
        updateData.elevationSeries = JSON.stringify(data.elevationSeries)
      } else {
        updateData.elevationSeries = data.elevationSeries ?? null
      }
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
    // No `activityType` filter: an untyped activity is counted, as its own
    // group, so the totals equal the calendar's sum for the same window.
    const rows = await countableActivitiesInWindow(database, {
      actorId,
      startDate,
      endDate
    })
      .groupBy('fitness_files.activityType')
      .select(
        'fitness_files.activityType as activityType',
        database.raw('COUNT(*) as count'),
        ...(
          [
            ['totalDistanceMeters', 'totalDistanceMeters'],
            ['totalDurationSeconds', 'totalDurationSeconds'],
            ['elevationGainMeters', 'totalElevationGainMeters']
          ] as [string, string][]
        ).map(([col, alias]) =>
          database.raw('COALESCE(SUM(??), 0) as ??', [
            `fitness_files.${col}`,
            alias
          ])
        )
      )

    return rows.map((row: Record<string, unknown>) => ({
      // `null` stays `null`: `String(null)` would invent a "null" type.
      activityType:
        row.activityType === null || row.activityType === undefined
          ? null
          : String(row.activityType),
      count: Number(row.count),
      totalDistanceMeters: Number(row.totalDistanceMeters),
      totalDurationSeconds: Number(row.totalDurationSeconds),
      totalElevationGainMeters: Number(row.totalElevationGainMeters)
    }))
  },

  async getActorHasFitnessData({
    actorId,
    ...audience
  }: GetActorHasFitnessDataParams) {
    let query = database('fitness_files')
      .where('actorId', actorId)
      .where('processingStatus', 'completed')
      .where('isPrimary', true)
      .whereNull('deletedAt')
      .whereNotNull('activityType')
      .whereNotNull('activityStartTime')

    // The same status-visibility set the profile's posts and media use, so the
    // Fitness tab is offered to exactly the viewers who could see a fitness
    // post in it. `null` is the deliberate unfiltered (owner) audience.
    const visibleStatusIds = buildActorVisibleStatusIdsQuery({
      database,
      actorId,
      ...audience
    })
    if (visibleStatusIds) {
      query = query.whereIn('fitness_files.statusId', visibleStatusIds)
    }

    const row = await query.select(database.raw('1')).first()
    return Boolean(row)
  },

  async getFitnessActivityCalendarData({
    actorId,
    startDate,
    endDate,
    timeZone,
    activityType
  }: GetFitnessActivityCalendarDataParams): Promise<FitnessCalendarDay[]> {
    if (!isValidTimeZone(timeZone)) {
      throw new RangeError(`Invalid time zone: ${JSON.stringify(timeZone)}`)
    }

    let query = countableActivitiesInWindow(database, {
      actorId,
      startDate,
      endDate
    })
    if (activityType) {
      query = query.where('fitness_files.activityType', activityType)
    }

    // The range filter is the only SQL that touches time, and it is the same on
    // every backend. Days are bucketed here, by the same `startOfLocalDay` that
    // built the window, so a row lands in the day a day-details read for that
    // date would return it from.
    const rows: Record<string, unknown>[] = await query
      .select(
        'fitness_files.activityStartTime',
        'fitness_files.totalDistanceMeters',
        'fitness_files.totalDurationSeconds',
        'fitness_files.elevationGainMeters'
      )
      .orderBy([
        { column: 'fitness_files.activityStartTime', order: 'asc' },
        { column: 'fitness_files.id', order: 'asc' }
      ])

    const timed = rows.map((row) => ({
      ms: getCompatibleTime(row.activityStartTime as number | Date | string),
      distance: Number(row.totalDistanceMeters ?? 0),
      duration: Number(row.totalDurationSeconds ?? 0),
      elevation: Number(row.elevationGainMeters ?? 0)
    }))

    return bucketByLocalDay(timed, timeZone, (row) => row.ms).map(
      ({ date, rows: dayRows }) => ({
        date,
        count: dayRows.length,
        totalDistanceMeters: dayRows.reduce(
          (sum, row) => sum + row.distance,
          0
        ),
        totalDurationSeconds: dayRows.reduce(
          (sum, row) => sum + row.duration,
          0
        ),
        totalElevationGainMeters: dayRows.reduce(
          (sum, row) => sum + row.elevation,
          0
        )
      })
    )
  },

  async getFitnessActivitiesInWindow({
    actorId,
    startDate,
    endDate,
    limit,
    offset
  }: GetFitnessActivitiesInWindowParams): Promise<FitnessWindowActivityPage> {
    const pageSize = Math.min(
      MAX_WINDOW_PAGE_SIZE,
      Math.max(1, Math.floor(limit))
    )
    const skip = Math.max(0, Math.floor(offset))

    // One row past the page answers `hasMore` without a second COUNT query.
    const rows: Record<string, unknown>[] = await countableActivitiesInWindow(
      database,
      { actorId, startDate, endDate }
    )
      .select(
        'fitness_files.id',
        'fitness_files.statusId',
        'fitness_files.activityType',
        'fitness_files.activityStartTime',
        'fitness_files.totalDistanceMeters',
        'fitness_files.totalDurationSeconds',
        'fitness_files.elevationGainMeters',
        'fitness_files.description',
        'fitness_files.fileName'
      )
      .orderBy([
        { column: 'fitness_files.activityStartTime', order: 'asc' },
        { column: 'fitness_files.id', order: 'asc' }
      ])
      .limit(pageSize + 1)
      .offset(skip)

    const toNumberOrNull = (value: unknown) =>
      value === null || value === undefined ? null : Number(value)

    return {
      activities: rows.slice(0, pageSize).map((row): FitnessWindowActivity => ({
        id: String(row.id),
        statusId: row.statusId ? String(row.statusId) : null,
        activityType: row.activityType ? String(row.activityType) : null,
        startTime: getCompatibleTime(
          row.activityStartTime as number | Date | string
        ),
        totalDistanceMeters: toNumberOrNull(row.totalDistanceMeters),
        totalDurationSeconds: toNumberOrNull(row.totalDurationSeconds),
        elevationGainMeters: toNumberOrNull(row.elevationGainMeters),
        description: row.description ? String(row.description) : null,
        fileName: String(row.fileName)
      })),
      hasMore: rows.length > pageSize
    }
  },

  async getFitnessActivityTimeBounds({
    actorId
  }: GetFitnessActivityTimeBoundsParams): Promise<FitnessActivityTimeBounds> {
    const row = await applyCountableActivityFilter(
      database,
      database('fitness_files'),
      'fitness_files'
    )
      .where('fitness_files.actorId', actorId)
      .whereNotNull('fitness_files.activityStartTime')
      .min('fitness_files.activityStartTime as earliest')
      .first()

    const earliest = (row as Record<string, unknown> | undefined)?.earliest
    return {
      earliest:
        earliest === null || earliest === undefined
          ? null
          : getCompatibleTime(earliest as number | Date | string)
    }
  }
})
