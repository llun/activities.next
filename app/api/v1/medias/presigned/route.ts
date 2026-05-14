import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  PresignedUploadValidationError,
  completePresignedMediaUpload,
  getPresignedUrl
} from '@/lib/services/medias'
import { PresigedMediaInput } from '@/lib/services/medias/types'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_404,
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.PATCH
]

const CompletePresignedUploadInput = z.object({
  mediaId: z.string().min(1)
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'getPresignedUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    try {
      const content = await req.json()
      const parsed = PresigedMediaInput.safeParse(content)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const presigned = await getPresignedUrl(
        database,
        currentActor,
        parsed.data
      )

      if (!presigned) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { presigned }
      })
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  })
)

export const PATCH = traceApiRoute(
  'completePresignedMediaUpload',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    try {
      const parsed = CompletePresignedUploadInput.safeParse(
        await req.json().catch(() => null)
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const media = await completePresignedMediaUpload(
        database,
        currentActor,
        parsed.data.mediaId
      )
      if (!media) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { media }
      })
    } catch (error) {
      if (error instanceof PresignedUploadValidationError) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
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
