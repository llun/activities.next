import { Database } from '@/lib/database/types'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'
import { getQueue } from '@/lib/services/queue'
import { getStravaActivityIdFromBatchId } from '@/lib/services/strava/activityBatch'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

export type RetryFitnessVisibility =
  'public' | 'unlisted' | 'private' | 'direct'

/**
 * A fitness file is worth retrying when its import failed, its map processing
 * failed, or it has been stranded in `processing` long enough that its worker
 * must have died mid-job (see {@link isFitnessProcessingStuck}). A genuinely
 * in-flight (recent `processing`) file is left alone.
 */
export const isRetriableFitnessFile = (
  file: Pick<FitnessFile, 'importStatus' | 'processingStatus' | 'updatedAt'>,
  now: number = Date.now()
): boolean =>
  file.importStatus === 'failed' ||
  file.processingStatus === 'failed' ||
  isFitnessProcessingStuck(
    { processingStatus: file.processingStatus, updatedAt: file.updatedAt },
    now
  )

interface RetryFitnessImportBatchParams {
  database: Database
  batchId: string
  batchActorId: string
  files: FitnessFile[]
  visibility: RetryFitnessVisibility
  now?: number
}

/**
 * Requeues the failed/stuck files of a single import batch. Shared by the
 * per-batch retry endpoint and the per-actor "retry all" endpoint so both
 * reset state and requeue identically.
 *
 * Each status column is reset only for the files that actually failed on it: a
 * file whose import already succeeded but whose later map processing failed
 * keeps its `completed` import status, because re-running importStravaActivityJob
 * short-circuits past the importer when a statusId exists (resetting it to
 * `pending` would strand it). A `strava-activity:<id>` batch re-runs the full
 * Strava importer (re-fetching caption/photos/visibility); other batches re-run
 * the file importer with the surviving completed files as overlap context.
 *
 * Throws if the queue publish fails (after restoring the pre-retry state) so
 * callers can surface the error.
 */
export const retryFitnessImportBatch = async ({
  database,
  batchId,
  batchActorId,
  files,
  visibility,
  now = Date.now()
}: RetryFitnessImportBatchParams): Promise<{ retried: number }> => {
  const retriableFiles = files
    .filter((file) => isRetriableFitnessFile(file, now))
    .map((file) => ({
      file,
      importStatus: file.importStatus ?? 'pending',
      importError: file.importError ?? null,
      processingStatus: file.processingStatus ?? 'pending'
    }))

  if (retriableFiles.length === 0) {
    return { retried: 0 }
  }

  const retriableFileIds = retriableFiles.map(({ file }) => file.id)
  const overlapFitnessFileIds = files
    .filter(
      (file) =>
        file.importStatus === 'completed' &&
        file.processingStatus === 'completed' &&
        Boolean(file.statusId)
    )
    .map((file) => file.id)

  const importResetFileIds = retriableFiles
    .filter(({ importStatus }) => importStatus === 'failed')
    .map(({ file }) => file.id)
  const processingResetFileIds = retriableFiles
    .filter(
      ({ processingStatus }) =>
        processingStatus === 'failed' || processingStatus === 'processing'
    )
    .map(({ file }) => file.id)

  if (importResetFileIds.length > 0) {
    await database.updateFitnessFilesImportStatus({
      fitnessFileIds: importResetFileIds,
      importStatus: 'pending'
    })
  }
  if (processingResetFileIds.length > 0) {
    await database.updateFitnessFilesProcessingStatus({
      fitnessFileIds: processingResetFileIds,
      processingStatus: 'pending'
    })
  }

  const stravaActivityId = getStravaActivityIdFromBatchId(batchId)
  const retryJob = stravaActivityId
    ? {
        // A `strava-activity:<id>` batch re-runs the full Strava importer, which
        // re-fetches the activity for its caption, photos and real visibility —
        // so `visibility` is intentionally OMITTED here and the job re-derives
        // the activity's actual Strava visibility. Do not add it back.
        id: getHashFromString(
          `${batchActorId}:strava-activity-retry:${batchId}`
        ),
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: batchActorId,
          stravaActivityId
        }
      }
    : {
        id: getHashFromString(
          `${batchActorId}:fitness-import-retry:${batchId}`
        ),
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: batchActorId,
          batchId,
          fitnessFileIds: retriableFileIds,
          overlapFitnessFileIds,
          visibility
        }
      }

  try {
    await getQueue().publish(retryJob)
  } catch (error) {
    await Promise.all(
      retriableFiles.map(async (item) => {
        await Promise.all([
          database.updateFitnessFileImportStatus(
            item.file.id,
            item.importStatus,
            item.importError ?? undefined
          ),
          database.updateFitnessFileProcessingStatus(
            item.file.id,
            item.processingStatus
          )
        ])
      })
    )

    logger.error({
      message: 'Failed to queue retry for fitness imports',
      actorId: batchActorId,
      batchId,
      retried: retriableFiles.length,
      error: error instanceof Error ? error.message : String(error)
    })

    throw error
  }

  logger.info({
    message: 'Queued retry for failed fitness imports',
    actorId: batchActorId,
    batchId,
    retried: retriableFiles.length
  })

  return { retried: retriableFiles.length }
}
