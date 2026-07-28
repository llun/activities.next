import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_403,
  ERROR_422,
  ERROR_500,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'retryFitnessProcessing',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return apiCorsError(req, CORS_HEADERS, 404)

    if (status.actorId !== currentActor.id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const files = await database.getFitnessFilesByStatus({ statusId })
    // `failed` files are the explicit failure case. A file still marked
    // `processing` long after the job started is stranded too: the worker was
    // killed mid-job (e.g. OOM/deploy) before it could write `completed` or
    // `failed`, and nothing re-queues it. Treat such stuck files as retriable
    // while leaving genuinely in-flight jobs (recent `processing`) alone.
    //
    // A `completed` file carrying a `mapError` is the third case: the activity
    // imported, but its route map could not be rendered or stored. Re-running
    // the job is exactly what regenerates it, and this endpoint is the retry
    // the post offers its owner — the batch "retry failed" path deliberately
    // does not pick these up, because it would re-run the whole import.
    //
    // Only for a file that is finished and owns the status's map, though: a
    // non-primary file (the second device of a merged same-ride post) must not
    // produce a map at all, so a reason left on one would otherwise make the
    // status retriable forever and attach a second route map on every click.
    const now = Date.now()
    // Whether this file's ACTIVITY is fine and only its map is not — which is
    // what decides both that it is worth retrying at all and that a failure in
    // the retry must not demote it. `completed` for the file that is sitting
    // there with a recorded reason; `processing` too, because a map retry parks
    // the file there and a worker that dies leaves it stuck: without this the
    // follow-up retry would take the plain `failed` path and hide a live
    // activity everywhere.
    const isMapOnlyFailure = (file: (typeof files)[number]) =>
      Boolean(file.mapError) &&
      file.isPrimary !== false &&
      (file.processingStatus === 'completed' ||
        file.processingStatus === 'processing')
    const isRetriableMapFailure = (file: (typeof files)[number]) =>
      isMapOnlyFailure(file) && file.processingStatus === 'completed'
    const retriableFiles = files.filter(
      (file) =>
        file.processingStatus === 'failed' ||
        isRetriableMapFailure(file) ||
        isFitnessProcessingStuck(file, now)
    )

    if (retriableFiles.length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const retryTimestamp = Date.now()
    const publishedFileIds: string[] = []
    try {
      for (const file of retriableFiles) {
        // `processing` for a map-only failure, not `pending`: it marks the run
        // as in flight, so a second click (a stale tab, an impatient owner)
        // finds nothing retriable instead of queueing a second job that
        // attaches a second map — the queue ids are salted per request, so
        // nothing else de-duplicates them. `pending` would not do: it is never
        // detected as stranded, so a dropped queue message would leave the post
        // spinning with no retry left to offer, while a stuck `processing` file
        // gets its retry back after the staleness window.
        await database.updateFitnessFileProcessingStatus(
          file.id,
          isRetriableMapFailure(file) ? 'processing' : 'pending'
        )
        await getQueue().publish({
          id: getHashFromString(
            `${statusId}:${file.id}:retry-fitness:${retryTimestamp}`
          ),
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: currentActor.id,
            statusId,
            fitnessFileId: file.id,
            publishSendNote: false,
            // This file's activity is live and fine; only its map is not. Tells
            // the job not to demote it if this run fails too.
            retryingMapFailure: isMapOnlyFailure(file)
          }
        })
        publishedFileIds.push(file.id)
      }
    } catch (error) {
      const unpublishedFiles = retriableFiles.filter(
        (f) => !publishedFileIds.includes(f.id)
      )

      for (const file of unpublishedFiles) {
        try {
          // A map-only failure goes back to `completed`: it never failed as an
          // activity, and `failed` would hide it behind every surface gated on
          // `completed`. Its `mapError` is untouched by a status write, so the
          // post keeps offering the retry.
          if (isRetriableMapFailure(file)) {
            await database.updateFitnessFileProcessingStatus(
              file.id,
              'completed'
            )
            continue
          }

          // Restore the reason the reset to `pending` cleared. Without it the
          // file rolls back to `failed` with no explanation — losing the
          // diagnostic exactly when the retry could not even be queued.
          //
          // `failed` deliberately, even for a file that was `processing`:
          // writing `processing` back would stamp a fresh `updatedAt`, so it
          // would no longer read as stranded and the owner would lose the retry
          // affordance for another staleness window.
          await database.updateFitnessFileProcessingStatus(
            file.id,
            'failed',
            file.importError ?? undefined
          )
        } catch (rollbackError) {
          logger.error({
            message: 'Failed to roll back fitness file status',
            fitnessFileId: file.id,
            statusId,
            err: toLoggableError(rollbackError)
          })
        }
      }

      logger.error({
        message: 'Failed to queue retry for fitness processing',
        statusId,
        actorId: currentActor.id,
        published: publishedFileIds.length,
        failed: unpublishedFiles.length,
        err: toLoggableError(error)
      })

      if (publishedFileIds.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }
    }

    logger.info({
      message: 'Retrying fitness processing',
      statusId,
      actorId: currentActor.id,
      retriedFiles: publishedFileIds.length
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { statusId, retried: publishedFileIds.length }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
