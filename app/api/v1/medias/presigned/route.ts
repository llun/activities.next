import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getPresignedUrl } from '@/lib/services/medias'
import { PresigedMediaInput } from '@/lib/services/medias/types'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'getPresignedUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    try {
      const content = await req.json()
      const input = PresigedMediaInput.safeParse(content)
      if (!input.success) {
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
        input.data
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
