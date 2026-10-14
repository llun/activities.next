import { NextRequest } from 'next/server'

import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import {
  ImportLockTimeoutError,
  withImportLock
} from '@/lib/services/fitness-files/importLock'
import { getStatusFitnessFiles } from '@/lib/services/fitness-files/statusFitnessFiles'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

/**
 * An error with a message the page shows as it is. These rejections are about
 * the owner's own recordings, so saying which one applies leaks nothing.
 */
const messageResponse = (
  req: NextRequest,
  status: typeof HTTP_STATUS.CONFLICT | typeof HTTP_STATUS.UNPROCESSABLE_ENTITY,
  error: string
) =>
  apiResponse({
    req,
    allowedMethods: [],
    data: { error },
    responseStatusCode: status
  })

interface Params {
  id: string
}

const QUEUE_FAILURE_REASON = 'Failed to queue the route map update'

const NOT_READY_MESSAGE =
  "This recording isn't ready yet. Wait for it to finish processing."
const PRIMARY_BUSY_MESSAGE =
  'The current primary recording is still processing. Try again once it has finished.'
const IMPORT_BUSY_MESSAGE =
  'Another import is updating this activity. Try again in a moment.'

/**
 * Makes one of an activity's recordings its primary one: the file the stat
 * grid, the route map, the heatmap's source and every rollup read. Owner only.
 * The post's text is not touched; it keeps what was written at import.
 *
 * An activity can hold several overlapping recordings (a watch and a bike
 * computer on the same ride). The importer picks the primary when it merges them;
 * this lets the owner overrule it. No body.
 *
 * - `404` for a missing or deleted file, someone else's file, or a file with no
 *   status: every rejection looks alike, so the response cannot confirm that an
 *   id exists.
 * - `422` with an `{ error }` text saying which: the recording is not a
 *   finished import yet, or the current primary is still being processed.
 * - `409` with an `{ error }` text when another import held the actor's import
 *   lock for the whole wait. Nothing was changed; the caller can retry.
 * - `200` with the file and `processed`, also when it already is the primary
 *   (nothing is re-queued then, so a double click does not rebuild the map
 *   twice). `processed` is true when the processing job has already run by the
 *   time the response goes out (an inline queue), so the file's map is final
 *   and the page can re-read it; false when the job is only queued, in which
 *   case a refresh now would just show the old map.
 *
 * The flag, the gear and the route map's pointers move in one transaction (see
 * `makeFitnessFilePrimary`); the new primary is then reprocessed so the post's
 * map is redrawn from ITS coordinates. That is the processing job and nothing
 * else: route heatmaps are deliberately not rebuilt here, for the reason
 * `processFitnessFileJob` gives, and the new primary's polyline is cached by
 * that same job.
 */
export const POST = traceApiRoute(
  'makeFitnessFilePrimary',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    try {
      // The importer's own lock, so a swap cannot land in the middle of an
      // import merging into the same status. Waits like the importers do and
      // then gives up (`failOnTimeout`, a 409 below) rather than swapping
      // underneath them. Holding it across the publish is safe for an inline
      // queue, whose processing job takes no lock of its own; that job can
      // outlast the default TTL, so it gets the importers' longer one.
      let processed = false
      const outcome = await withImportLock(
        database,
        `fitness-import:${currentActor.id}`,
        async () => {
          const swap = await database.makeFitnessFilePrimary({
            fitnessFileId: id,
            actorId: currentActor.id
          })
          if (swap.result !== 'promoted') return swap

          const statusId = swap.fitnessFile.statusId as string
          try {
            const queue = getQueue()
            await queue.publish({
              // Salted: the job id is a dedupe key, and the import that
              // created this file already used `${status}:${file}:process-fitness`.
              id: getHashFromString(
                `${statusId}:${id}:make-primary:${Date.now()}`
              ),
              name: PROCESS_FITNESS_FILE_JOB_NAME,
              data: {
                actorId: currentActor.id,
                statusId,
                fitnessFileId: id,
                // The Create went out with the original import, and the owner
                // is the one asking, so nothing is federated or emailed.
                publishSendNote: false,
                notifyOnComplete: false,
                // The file is a finished, live activity, so a failure of this
                // run must be recorded as a missing map rather than demote it
                // to `failed` and hide it from every surface.
                retryingMapFailure: true
              }
            })
            processed = queue.runsInline
          } catch (error) {
            // The swap is committed and the post still shows the old file's
            // map. Record it where the feature's state lives: a `completed`
            // primary with a `mapError` is the state the post's own retry
            // button picks up.
            logger.error({
              message: 'Failed to queue processing for the new primary file',
              fitnessFileId: id,
              statusId,
              actorId: currentActor.id,
              err: toLoggableError(error)
            })
            try {
              await database.updateFitnessFileActivityData(id, {
                mapError: QUEUE_FAILURE_REASON
              })
            } catch (writeError) {
              // The swap is committed either way, so the owner must hear
              // success: reporting a failure would invite a retry of an
              // action that already happened.
              logger.error({
                message: 'Failed to record the route map reason',
                fitnessFileId: id,
                statusId,
                actorId: currentActor.id,
                err: toLoggableError(writeError)
              })
            }
          }
          return swap
        },
        {
          failOnTimeout: true,
          ...(getQueue().runsInline ? { ttlMs: 5 * 60 * 1000 } : {})
        }
      )

      if (outcome.result === 'not_found') {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }
      if (outcome.result === 'not_ready') {
        return messageResponse(
          req,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          NOT_READY_MESSAGE
        )
      }
      if (outcome.result === 'primary_busy') {
        return messageResponse(
          req,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          PRIMARY_BUSY_MESSAGE
        )
      }

      // The shape the activity page already holds for each file (gear names
      // resolved, the stuck flag), rather than the raw row with its storage
      // paths.
      const files = await getStatusFitnessFiles(
        database,
        outcome.fitnessFile.statusId as string
      )
      const file = files.find((item) => item.id === id)
      if (!file) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

      return apiResponse({
        req,
        allowedMethods: [],
        data: { ...file, processed },
        responseStatusCode: 200
      })
    } catch (error) {
      if (error instanceof ImportLockTimeoutError) {
        return messageResponse(req, HTTP_STATUS.CONFLICT, IMPORT_BUSY_MESSAGE)
      }
      logger.error({
        message: 'Error making fitness file primary',
        fitnessFileId: id,
        actorId: currentActor.id,
        err: toLoggableError(error)
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
