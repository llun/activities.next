import { REGENERATE_FITNESS_MAPS_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import type { FitnessProcessingStatus } from '@/lib/types/database/fitnessFile'
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

    const queuedFiles: Array<{
      id: string
      processingStatus: FitnessProcessingStatus
    }> = []
    let offset = 0

    while (true) {
      const page = await database.getFitnessFilesByActor({
        actorId: currentActor.id,
        limit: FITNESS_FILE_PAGE_SIZE,
        offset
      })

      for (const file of page) {
        if (!file.statusId) {
          continue
        }

        if (file.processingStatus === 'processing') {
          continue
        }

        queuedFiles.push({
          id: file.id,
          processingStatus: file.processingStatus ?? 'pending'
        })
      }

      if (page.length < FITNESS_FILE_PAGE_SIZE) {
        break
      }

      offset += FITNESS_FILE_PAGE_SIZE
    }

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
            file.processingStatus
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
