import { z } from 'zod'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import {
  getFilteredStatusPage,
  normalizeTimelineLimit
} from '@/lib/services/timelines/getFilteredTimelinePage'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  tag: z.string().regex(/^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/)
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

      const { tag } = parseResult.data
      const url = new URL(req.url)
      const maxStatusIdParam = url.searchParams.get('max_id')
      const limitParam = url.searchParams.get('limit')
      const format = url.searchParams.get('format')

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

      if (format === TimelineFormat.enum.activities_next) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: statuses.map((item) => cleanJson(item)),
            nextMaxStatusId
          }
        })
      }

      const host = headerHost(req.headers)
      const encodedTag = encodeURIComponent(tag)
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/tags/${encodedTag}?limit=${effectiveLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
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
      const { tag } = await context.params
      return { tag }
    }
  }
)
