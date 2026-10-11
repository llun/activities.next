// Parameter and result types and the `FitnessFileDatabase` interface of the
// fitness file domain. The parsed `FitnessFile` type lives in
// lib/types/database/fitnessFile.ts, the overview result types in
// lib/fitness/calendar/types.ts; the stored row type is the generated
// `FitnessFiles` table type in lib/database/kysely/db.ts.
import type {
  FitnessActivitySummary,
  FitnessActivityTimeBounds,
  FitnessCalendarDay,
  FitnessWindowActivity,
  FitnessWindowActivityPage
} from '@/lib/fitness/calendar/types'
import type {
  FitnessFile,
  FitnessFileType,
  FitnessImportStatus,
  FitnessProcessingStatus
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
