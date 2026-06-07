import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// POST /api/v1/media — Mastodon's deprecated synchronous upload. Same parameters
// and `write:media` scope as v2, but it always finishes processing before
// responding, so it only ever returns 200 with a fully-processed
// MediaAttachment (no 202 path). `saveMedia` is synchronous here, matching that
// contract.
export const POST = traceApiRoute(
  'uploadMediaV1',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, context) => {
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
    }
  )
)
