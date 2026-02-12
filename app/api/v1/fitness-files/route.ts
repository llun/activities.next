import { NextRequest } from 'next/server'

import { saveFitnessFile } from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { FitnessFileSchema } from '@/lib/services/fitness-files/types'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'uploadFitnessFile',
  AuthenticatedGuard(async (req: NextRequest, context) => {
    const { database, currentActor } = context

    try {
      const formData = await req.formData()
      const file = formData.get('file')
      const description = formData.get('description')

      if (!file || !(file instanceof File)) {
        logger.warn({ message: 'No file provided in fitness file upload' })
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      // Validate file
      const validationResult = FitnessFileSchema.safeParse(file)
      if (!validationResult.success) {
        logger.warn({
          message: 'Invalid fitness file',
          errors: validationResult.error.issues
        })
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      // Save fitness file
      const result = await saveFitnessFile(database, currentActor, {
        file,
        description: description ? String(description) : undefined
      })

      if (!result) {
        logger.error({ message: 'Failed to save fitness file' })
        return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: result
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error uploading fitness file',
        error: err.message
      })

      if (err instanceof QuotaExceededError) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }

      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
