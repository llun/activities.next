import { NextRequest } from 'next/server'
import { z } from 'zod'

import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { FitnessFileSchema } from '@/lib/services/fitness-files/types'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'importFitnessFiles',
  AuthenticatedGuard(async (req: NextRequest, context) => {
    const { database, currentActor } = context

    try {
      const formData = await req.formData()
      const visibilityValue = String(formData.get('visibility') ?? 'public')
      const visibilityParsed = Visibility.safeParse(visibilityValue)

      if (!visibilityParsed.success) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      const filesRaw = formData.getAll('files')
      const files = filesRaw.filter(
        (item): item is File => item instanceof File
      )

      if (files.length === 0 || files.length !== filesRaw.length) {
        logger.warn({
          message: 'Invalid fitness import request, missing files',
          actorId: currentActor.id
        })
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      const invalidFile = files.find(
        (file) => !FitnessFileSchema.safeParse(file).success
      )
      if (invalidFile) {
        logger.warn({
          message: 'Invalid fitness file in import batch',
          actorId: currentActor.id,
          fileName: invalidFile.name
        })
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      const batchId = crypto.randomUUID()
      const uploadedFiles = await Promise.all(
        files.map((file) =>
          saveFitnessFile(database, currentActor, {
            file,
            importBatchId: batchId
          })
        )
      )

      if (uploadedFiles.some((item) => !item)) {
        logger.error({
          message: 'Failed to save one or more fitness files for import',
          actorId: currentActor.id
        })
        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }

      const fitnessFileIds = uploadedFiles
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => item.id)

      await getQueue().publish({
        id: getHashFromString(`${currentActor.id}:fitness-import:${batchId}`),
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: currentActor.id,
          batchId,
          fitnessFileIds,
          visibility: visibilityParsed.data
        }
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          batchId,
          fileCount: fitnessFileIds.length
        }
      })
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Error importing fitness files',
        error: nodeError.message
      })

      if (nodeError instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
