import { REGENERATE_FITNESS_MAPS_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const FITNESS_FILE_PAGE_SIZE = 200

export const POST = traceApiRoute(
  'queueFitnessMapRegeneration',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const accountId = currentActor.account?.id
    if (!accountId) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const fitnessFiles = []
    let offset = 0

    while (true) {
      const page = await database.getFitnessFilesByActor({
        actorId: currentActor.id,
        limit: FITNESS_FILE_PAGE_SIZE,
        offset
      })

      fitnessFiles.push(...page)
      if (page.length < FITNESS_FILE_PAGE_SIZE) {
        break
      }

      offset += FITNESS_FILE_PAGE_SIZE
    }

    const queuedFiles = fitnessFiles.filter((file) => {
      if (!file.statusId) {
        return false
      }

      return file.processingStatus !== 'processing'
    })

    if (queuedFiles.length === 0) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          queuedCount: 0
        }
      })
    }

    const previousProcessingStatusById = new Map(
      queuedFiles.map((file) => [file.id, file.processingStatus ?? 'pending'])
    )

    await database.updateFitnessFilesProcessingStatus({
      fitnessFileIds: queuedFiles.map((file) => file.id),
      processingStatus: 'processing'
    })

    try {
      await getQueue().publish({
        id: getHashFromString(
          `${currentActor.id}:fitness-map-regeneration:${Date.now()}`
        ),
        name: REGENERATE_FITNESS_MAPS_JOB_NAME,
        data: {
          actorId: currentActor.id,
          fitnessFileIds: queuedFiles.map((file) => file.id)
        }
      })
    } catch (error) {
      await Promise.all(
        queuedFiles.map(async (file) => {
          await database.updateFitnessFileProcessingStatus(
            file.id,
            previousProcessingStatusById.get(file.id) ?? 'pending'
          )
        })
      )

      const nodeError = error as Error
      logger.error({
        message: 'Failed to queue old-status map regeneration job',
        actorId: currentActor.id,
        accountId,
        queuedCount: queuedFiles.length,
        error: nodeError.message
      })

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        success: true,
        queuedCount: queuedFiles.length
      }
    })
  })
)
