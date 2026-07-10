import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { unfeatureTag } from '@/lib/services/mastodon/featureTag'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import {
  MAX_ENCODED_HASHTAG_PARAM_LENGTH,
  normalizeHashtagParam
} from '@/lib/utils/text/mastodonHashtag'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  // Cap the raw (percent-encoded) param; normalizeHashtagParam enforces the
  // 255-char limit on the decoded name so Unicode tags aren't rejected early.
  tag: z.string().max(MAX_ENCODED_HASHTAG_PARAM_LENGTH)
})

interface RouteParams {
  tag: string
}

// POST /api/v1/tags/:tag/unfeature — stop featuring a hashtag and return the
// Tag entity (Mastodon 4.4). Idempotent: unfeaturing a tag that is not
// featured is a no-op, not an error.
// https://docs.joinmastodon.org/methods/tags/#unfeature
// Scope write:accounts (satisfied by the aggregate `write`).
export const POST = traceApiRoute(
  'unfeatureTag',
  OAuthGuardAnyScope<RouteParams>(
    [Scope.enum.write, Scope.enum['write:accounts']],
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

      await unfeatureTag({ database, actorId: currentActor.id, name: tag })
      const following = await database.isFollowingTag({
        actorId: currentActor.id,
        name: tag
      })
      // Return the Tag entity with featuring:false. Idempotent no-op when the
      // tag was not featured, so there is no 422 path. History stays empty (the
      // unfeature action does not compute the seven-day usage window).
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonTag(tag, following, [], false)
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
