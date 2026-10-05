import { NextRequest } from 'next/server'

import { saveFitnessFile } from '@/lib/services/fitness-files'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { FitnessFileSchema } from '@/lib/services/fitness-files/types'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_413,
  ERROR_500,
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
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      // Validate file
      const validationResult = FitnessFileSchema.safeParse(file)
      if (!validationResult.success) {
        logger.warn({
          message: 'Invalid fitness file',
          errors: validationResult.error.issues
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      // The description is persisted as unbounded text and is not counted by
      // the byte quota, so a tiny valid file with a huge description would be a
      // free way to fill the database. Hold it to the instance's post length.
      const descriptionText = description ? String(description) : undefined
      if (descriptionText) {
        const { posts } = await getResolvedServerSettings(database)
        if (descriptionText.length > posts.maxCharacters) {
          logger.warn({
            message: 'Fitness file description exceeds the character limit',
            length: descriptionText.length,
            limit: posts.maxCharacters
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_400,
            responseStatusCode: 400
          })
        }
      }

      // Save fitness file
      const result = await saveFitnessFile(database, currentActor, {
        file,
        description: descriptionText
      })

      if (!result) {
        logger.error({ message: 'Failed to save fitness file' })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
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
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_413,
          responseStatusCode: 413
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }
  })
)
