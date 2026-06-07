import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { getFilteredStatusPage } from '@/lib/services/timelines/getFilteredTimelinePage'
import {
  parseTimelineQuery,
  timelineErrorBoundary
} from '@/lib/services/timelines/request'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

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
    timelineErrorBoundary(CORS_HEADERS, async (req, context) => {
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
      const parsedQuery = parseTimelineQuery(url.searchParams)
      if (!parsedQuery.ok) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const effectiveLimit = parsedQuery.query.limit

      const { statuses, nextMaxStatusId } = await getFilteredStatusPage({
        database,
        actorId: currentActor?.id,
        maxStatusId: parsedQuery.query.maxStatusId,
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
      // Only `next` (older) is emitted: the hashtag query pages forward by
      // `max_id` only and has no lower-bound cursor, so a `prev`/`min_id` link
      // would not actually page to newer statuses.
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
    }),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  ),
  {
    addAttributes: async (_req, context) => {
      const { hashtag } = await context.params
      return { hashtag }
    }
  }
)
