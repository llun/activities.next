import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  apiErrorResponse,
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
    if (!encodedStatusId) return apiErrorResponse(404)

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return apiErrorResponse(404)

    if (status.actorId !== currentActor.id) {
      return apiErrorResponse(403)
    }

    const files = await database.getFitnessFilesByStatus({ statusId })
    const retriableFiles = files.filter(
      (file) =>
        file.processingStatus === 'failed' ||
        file.processingStatus === 'processing'
    )

    if (retriableFiles.length === 0) {
      return apiErrorResponse(422)
    }

    for (const file of retriableFiles) {
      await database.updateFitnessFileProcessingStatus(file.id, 'pending')
      await getQueue().publish({
        id: getHashFromString(`${statusId}:${file.id}:retry-fitness`),
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: currentActor.id,
          statusId,
          fitnessFileId: file.id,
          publishSendNote: false
        }
      })
    }

    logger.info({
      message: 'Retrying fitness processing',
      statusId,
      actorId: currentActor.id,
      retriedFiles: retriableFiles.length
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { statusId, retried: retriableFiles.length }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
