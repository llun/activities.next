import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  FEATURED_TAGS_LIMIT,
  featureTag
} from '@/lib/services/mastodon/featureTag'
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

// POST /api/v1/tags/:tag/feature — feature a hashtag on the current profile
// and return the Tag entity (Mastodon 4.4).
// https://docs.joinmastodon.org/methods/tags/#feature
// Scope write:accounts (satisfied by the aggregate `write`). Same semantics as
// POST /api/v1/featured_tags: idempotent on an already-featured tag, 422 once
// the per-account cap of 10 is reached.
export const POST = traceApiRoute(
  'featureTag',
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

      const result = await featureTag({
        database,
        actorId: currentActor.id,
        name: tag
      })
      if (result.status === 'limit_reached') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error: `You can only feature up to ${FEATURED_TAGS_LIMIT} hashtags`
          },
          responseStatusCode: 422
        })
      }

      const following = await database.isFollowingTag({
        actorId: currentActor.id,
        name: tag
      })
      // Return the Tag entity with featuring:true. This endpoint does not
      // compute the seven-day usage window, so history stays empty (Mastodon's
      // response includes it, but the feature action doesn't require it).
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonTag(tag, following, [], true)
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
