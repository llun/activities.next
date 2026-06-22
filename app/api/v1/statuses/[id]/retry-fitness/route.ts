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
    const now = Date.now()
    const retriableFiles = files.filter(
      (file) =>
        file.processingStatus === 'failed' ||
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
        await database.updateFitnessFileProcessingStatus(file.id, 'pending')
        await getQueue().publish({
          id: getHashFromString(
            `${statusId}:${file.id}:retry-fitness:${retryTimestamp}`
          ),
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: currentActor.id,
            statusId,
            fitnessFileId: file.id,
            publishSendNote: false
          }
        })
        publishedFileIds.push(file.id)
      }
    } catch (error) {
      const nodeError = error as Error
      const unpublishedFiles = retriableFiles.filter(
        (f) => !publishedFileIds.includes(f.id)
      )

      for (const file of unpublishedFiles) {
        try {
          await database.updateFitnessFileProcessingStatus(file.id, 'failed')
        } catch (rollbackError) {
          logger.error({
            message: 'Failed to roll back fitness file status',
            fitnessFileId: file.id,
            statusId,
            error: (rollbackError as Error).message
          })
        }
      }

      logger.error({
        message: 'Failed to queue retry for fitness processing',
        statusId,
        actorId: currentActor.id,
        published: publishedFileIds.length,
        failed: unpublishedFiles.length,
        error: nodeError.message
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
