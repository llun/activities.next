import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import { retryFitnessImportBatch } from '@/lib/services/fitness-files/retryImports'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Manual upload retries publish as private so a recovery never re-publishes a
// post more visibly than the owner intended; `strava-activity:<id>` batches
// ignore this and re-derive the activity's real Strava visibility.
const RETRY_VISIBILITY = 'private'

/**
 * Retries every failed or stuck fitness import for the current actor in one
 * action, so the owner doesn't have to click Retry on each post. Each Strava
 * webhook import is its own batch + post, so a burst of simultaneous activities
 * that failed would otherwise need one Retry click apiece.
 */
export const POST = traceApiRoute(
  'retryAllFailedFitnessImports',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const now = Date.now()

    // One lean query returns just the distinct retriable batch ids (a file with
    // no import batch can't be requeued through the batch importer and keeps its
    // own per-post Retry button), instead of paging through every file row.
    const retriableBatchIds = await database.getRetriableFitnessImportBatchIds({
      actorId: currentActor.id,
      stuckBefore: new Date(now - STUCK_PROCESSING_THRESHOLD_MS)
    })

    // Each batch is independent, so requeue them concurrently. allSettled keeps
    // one batch's failure from blocking the rest; retryFitnessImportBatch
    // already rolls back and logs on its own failure.
    const results = await Promise.allSettled(
      retriableBatchIds.map(async (batchId) => {
        const batchFiles = await database.getFitnessFilesByBatchId({ batchId })
        const ownedFiles = batchFiles.filter(
          (file) => file.actorId === currentActor.id
        )
        if (ownedFiles.length === 0) {
          return 0
        }

        const { retried: batchRetried } = await retryFitnessImportBatch({
          database,
          batchId,
          batchActorId: currentActor.id,
          files: ownedFiles,
          visibility: RETRY_VISIBILITY,
          now
        })
        return batchRetried
      })
    )

    let retried = 0
    let batches = 0
    let failedBatches = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value > 0) {
          retried += result.value
          batches += 1
        }
      } else {
        failedBatches += 1
      }
    }

    logger.info({
      message: 'Retried all failed fitness imports for actor',
      actorId: currentActor.id,
      retried,
      batches,
      failedBatches
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { retried, batches, failedBatches }
    })
  })
)
