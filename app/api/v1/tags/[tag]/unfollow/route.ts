import { z } from 'zod'

import { OAuthGuard, corsErrorResponse } from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  tag: z.string().regex(/^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/)
})

interface RouteParams {
  tag: string
}

// https://docs.joinmastodon.org/methods/tags/#unfollow
export const POST = traceApiRoute(
  'unfollowTag',
  OAuthGuard<RouteParams>(
    [Scope.enum['write:follows']],
    async (req, { database, currentActor, params }) => {
      const parsed = Params.safeParse(await params)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const { tag } = parsed.data
      await database.unfollowTag({ actorId: currentActor.id, name: tag })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonTag(tag, false)
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
