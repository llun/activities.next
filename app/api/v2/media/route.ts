import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'uploadMediaV2',
  AuthenticatedGuard(async (req, context) => {
    try {
      const { database, currentActor } = context
      const form = await req.formData()
      const media = MediaSchema.safeParse(Object.fromEntries(form.entries()))
      if (!media.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const response = await saveMedia(database, currentActor, media.data)
      if (!response) {
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
        data: response
      })
    } catch (e) {
      const nodeErr = e as NodeJS.ErrnoException
      logger.error(nodeErr)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  })
)
