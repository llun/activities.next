import { z } from 'zod'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { TimelineFormat } from '@/lib/services/timelines/const'
import {
  getFilteredStatusPage,
  normalizeTimelineLimit
} from '@/lib/services/timelines/getFilteredTimelinePage'
import { getTagHistory } from '@/lib/services/trends/tagHistory'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import {
  MAX_ENCODED_HASHTAG_PARAM_LENGTH,
  normalizeHashtagParam
} from '@/lib/utils/text/mastodonHashtag'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  // Cap the raw (percent-encoded) param; normalizeHashtagParam enforces the
  // 255-char limit on the decoded name so Unicode tags aren't rejected early.
  tag: z.string().max(MAX_ENCODED_HASHTAG_PARAM_LENGTH)
})

interface RouteParams {
  tag: string
}

export const GET = traceApiRoute(
  'getHashtagTimeline',
  OptionalOAuthGuard<RouteParams>(
    [Scope.enum.read],
    async (req, context) => {
      const { database, currentActor, params: routeParams } = context
      const params = await routeParams
      const parseResult = Params.safeParse(params)
      if (!parseResult.success)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })

      const tag = normalizeHashtagParam(parseResult.data.tag)
      if (!tag)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })

      const url = new URL(req.url)
      const format = url.searchParams.get('format')

      // Default Mastodon behavior: GET /api/v1/tags/:id returns the Tag entity,
      // including whether the current actor follows it.
      // https://docs.joinmastodon.org/methods/tags/#get
      if (format !== TimelineFormat.enum.activities_next) {
        const [following, history] = await Promise.all([
          currentActor
            ? database.isFollowingTag({
                actorId: currentActor.id,
                name: tag
              })
            : Promise.resolve(false),
          getTagHistory(database, tag)
        ])
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: getMastodonTag(tag, following, history)
        })
      }

      // Legacy in-app timeline payload (format=activities_next), still consumed
      // by the web client. The Mastodon-standard hashtag timeline now lives at
      // GET /api/v1/timelines/tag/:hashtag.
      const maxStatusIdParam = url.searchParams.get('max_id')
      const limitParam = url.searchParams.get('limit')
      const parsedLimit = limitParam ? parseInt(limitParam, 10) : PER_PAGE_LIMIT
      const effectiveLimit = normalizeTimelineLimit(parsedLimit)

      const { statuses, nextMaxStatusId } = await getFilteredStatusPage({
        database,
        actorId: currentActor?.id,
        maxStatusId: maxStatusIdParam ? idToUrl(maxStatusIdParam) : null,
        limit: effectiveLimit,
        fetchBatch: ({ maxStatusId, limit }) =>
          database.getStatusesByHashtag({
            hashtag: tag,
            limit,
            maxStatusId: maxStatusId ?? undefined
          })
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          statuses: statuses.map((item) => cleanJson(item)),
          nextMaxStatusId
        }
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  ),
  {
    addAttributes: async (_req, context) => {
      const { tag } = await context.params
      return { tag }
    }
  }
)
