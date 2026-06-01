import { z } from 'zod'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import {
  getFilteredStatusPage,
  normalizeTimelineLimit
} from '@/lib/services/timelines/getFilteredTimelinePage'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  hashtag: z.string().regex(/^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/)
})

interface RouteParams {
  hashtag: string
}

// https://docs.joinmastodon.org/methods/timelines/#tag
export const GET = traceApiRoute(
  'getHashtagTimeline',
  OptionalOAuthGuard<RouteParams>(
    [Scope.enum.read],
    async (req, context) => {
      const { database, currentActor, params: routeParams } = context
      const parseResult = Params.safeParse(await routeParams)
      if (!parseResult.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const { hashtag } = parseResult.data
      const url = new URL(req.url)
      const maxStatusIdParam = url.searchParams.get('max_id')
      const limitParam = url.searchParams.get('limit')
      const effectiveLimit = normalizeTimelineLimit(
        limitParam ? parseInt(limitParam, 10) : PER_PAGE_LIMIT
      )

      const { statuses, nextMaxStatusId } = await getFilteredStatusPage({
        database,
        actorId: currentActor?.id,
        maxStatusId: maxStatusIdParam ? idToUrl(maxStatusIdParam) : null,
        limit: effectiveLimit,
        fetchBatch: ({ maxStatusId, limit }) =>
          database.getStatusesByHashtag({
            hashtag,
            limit,
            maxStatusId: maxStatusId ?? undefined
          })
      })

      const host = headerHost(req.headers)
      const encodedTag = encodeURIComponent(hashtag)
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/timelines/tag/${encodedTag}?limit=${effectiveLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      const links = [nextLink].filter(Boolean).join(', ')
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor?.id
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  ),
  {
    addAttributes: async (_req, context) => {
      const { hashtag } = await context.params
      return { hashtag }
    }
  }
)
