import { z } from 'zod'

import { OAuthGuard, corsErrorResponse } from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { getTagHistory } from '@/lib/services/trends/tagHistory'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { normalizeHashtagParam } from '@/lib/utils/text/mastodonHashtag'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  tag: z.string().max(255)
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

      const tag = normalizeHashtagParam(parsed.data.tag)
      if (!tag) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      await database.unfollowTag({ actorId: currentActor.id, name: tag })
      const history = await getTagHistory(database, tag)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonTag(tag, false, history)
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
