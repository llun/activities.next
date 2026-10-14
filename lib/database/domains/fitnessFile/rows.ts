// Pure helpers for `fitness_files` rows: the row mapper, the `importError`
// cap shared by every writer of the column, and the lenient paging rules. No
// database access, except the dialect check behind `limit -1`.
import type { SelectQueryBuilder, Selectable } from 'kysely'

import { normalizeOptionalNumber } from '@/lib/database/domains/fitnessGear/rows'
import type { DB, Db } from '@/lib/database/kysely'
import type { FitnessFiles } from '@/lib/database/kysely/db'
import { getDialectName } from '@/lib/database/kysely/dialect'
import type {
  FitnessFile,
  FitnessFileType,
  FitnessImportStatus,
  FitnessProcessingStatus
} from '@/lib/types/database/fitnessFile'

export type FitnessFileRow = Selectable<FitnessFiles>

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
export const truncateImportError = (importError: string) =>
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
export const buildProcessingStatusUpdate = (
  processingStatus: FitnessProcessingStatus,
  processingError?: string
): {
  processingStatus: FitnessProcessingStatus
  updatedAt: Date
  importError?: string | null
} => {
  const updateData: {
    processingStatus: FitnessProcessingStatus
    updatedAt: Date
    importError?: string | null
  } = {
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

/**
 * A `fitness_files` row as the domain `FitnessFile`. The driver has already
 * read timestamps as epoch milliseconds, `bytes` as a number and the booleans
 * as booleans, on both backends.
 *
 * `activityStartTime` and `deletedAt` are checked for truthiness, so an
 * epoch-0 value reads as unset.
 * `createdAt`/`updatedAt` are nullable columns every writer sets; a NULL one
 * reads as 0.
 */
export const toFitnessFile = (row: FitnessFileRow): FitnessFile => ({
  id: row.id,
  actorId: row.actorId,
  statusId: row.statusId ?? undefined,
  path: row.path,
  fileName: row.fileName,
  // Written only from FitnessFileType; the column is a plain varchar.
  fileType: row.fileType as FitnessFileType,
  mimeType: row.mimeType,
  bytes: Number(row.bytes),
  description: row.description ?? undefined,
  hasMapData: Boolean(row.hasMapData),
  mapImagePath: row.mapImagePath ?? undefined,
  mapImageEmailPath: row.mapImageEmailPath ?? undefined,
  mapError: row.mapError ?? undefined,
  processingStatus:
    (row.processingStatus as FitnessProcessingStatus | null) ?? 'pending',
  isPrimary:
    row.isPrimary === null || row.isPrimary === undefined
      ? true
      : Boolean(row.isPrimary),
  importBatchId: row.importBatchId ?? undefined,
  importStatus: (row.importStatus as FitnessImportStatus | null) ?? undefined,
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
  activityStartTime: row.activityStartTime || undefined,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0,
  deletedAt: row.deletedAt || undefined
})

// The paged reads read their limit and offset through parseInt and drop a NaN
// one, refuse a negative offset, and on SQLite write an offset without a
// limit as `limit -1 offset n` (SQLite has no bare OFFSET). Kysely binds
// whatever it is given, so these rules are applied here.
const pagingInteger = (value: number): number | null => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? null : parsed
}

export const withLenientPaging = <TB extends keyof DB, O>(
  db: Db,
  query: SelectQueryBuilder<DB, TB, O>,
  { limit, offset }: { limit: number; offset: number }
): SelectQueryBuilder<DB, TB, O> => {
  const limitValue = pagingInteger(limit)
  const offsetValue = pagingInteger(offset)
  if (offsetValue !== null && offsetValue < 0) {
    throw new Error('A non-negative integer must be provided to offset.')
  }
  const hasOffset = offsetValue !== null && offsetValue !== 0
  if (limitValue !== null) {
    query = query.limit(limitValue)
  } else if (hasOffset && getDialectName(db) === 'sqlite') {
    query = query.limit(-1)
  }
  return hasOffset ? query.offset(offsetValue) : query
}
