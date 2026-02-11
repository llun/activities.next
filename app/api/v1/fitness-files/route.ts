import { NextRequest } from 'next/server'

import { saveFitnessFile } from '@/lib/services/fitness-files'
import { FitnessFileSchema } from '@/lib/services/fitness-files/types'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { StatusCode, apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

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
        return apiErrorResponse(StatusCode.BadRequest)
      }

      // Validate file
      const validationResult = FitnessFileSchema.safeParse(file)
      if (!validationResult.success) {
        logger.warn({
          message: 'Invalid fitness file',
          errors: validationResult.error.errors
        })
        return apiErrorResponse(StatusCode.BadRequest)
      }

      // Save fitness file
      const result = await saveFitnessFile(database, currentActor, {
        file,
        description: description ? String(description) : undefined
      })

      if (!result) {
        logger.error({ message: 'Failed to save fitness file' })
        return apiErrorResponse(StatusCode.InternalServerError)
      }

      return apiResponse({
        data: result
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error uploading fitness file',
        error: err.message
      })

      if (err.message.includes('quota exceeded')) {
        return apiErrorResponse(StatusCode.PayloadTooLarge)
      }

      return apiErrorResponse(StatusCode.InternalServerError)
    }
  })
)
