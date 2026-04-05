import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
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
    if (!encodedStatusId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Not Found' },
        responseStatusCode: 404
      })

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Not Found' },
        responseStatusCode: 404
      })

    if (status.actorId !== currentActor.id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Forbidden' },
        responseStatusCode: 403
      })
    }

    const files = await database.getFitnessFilesByStatus({ statusId })
    const retriableFiles = files.filter(
      (file) => file.processingStatus === 'failed'
    )

    if (retriableFiles.length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unprocessable entity' },
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
          data: { error: 'Internal Server Error' },
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
