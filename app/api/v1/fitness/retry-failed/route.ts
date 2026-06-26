import {
  isRetriableFitnessFile,
  retryFitnessImportBatch
} from '@/lib/services/fitness-files/retryImports'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const FITNESS_FILE_PAGE_SIZE = 200

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

    // Collect the distinct batches that have at least one retriable file. A
    // file with no import batch can't be requeued through the batch importer;
    // its post keeps its own Retry button.
    const retriableBatchIds = new Set<string>()
    let offset = 0
    while (true) {
      const page = await database.getFitnessFilesByActor({
        actorId: currentActor.id,
        limit: FITNESS_FILE_PAGE_SIZE,
        offset
      })

      for (const file of page) {
        if (file.importBatchId && isRetriableFitnessFile(file, now)) {
          retriableBatchIds.add(file.importBatchId)
        }
      }

      if (page.length < FITNESS_FILE_PAGE_SIZE) {
        break
      }
      offset += FITNESS_FILE_PAGE_SIZE
    }

    let retried = 0
    let batches = 0
    let failedBatches = 0

    for (const batchId of retriableBatchIds) {
      const batchFiles = await database.getFitnessFilesByBatchId({ batchId })
      const ownedFiles = batchFiles.filter(
        (file) => file.actorId === currentActor.id
      )
      if (ownedFiles.length === 0) {
        continue
      }

      try {
        const { retried: batchRetried } = await retryFitnessImportBatch({
          database,
          batchId,
          batchActorId: currentActor.id,
          files: ownedFiles,
          visibility: RETRY_VISIBILITY,
          now
        })

        if (batchRetried > 0) {
          retried += batchRetried
          batches += 1
        }
      } catch {
        // retryFitnessImportBatch already rolled the batch back and logged the
        // failure; keep going so one bad batch doesn't block the rest.
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
      allowedMethods: [],
      data: { retried, batches, failedBatches }
    })
  })
)
