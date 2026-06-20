import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import {
  parseTimelineQuery,
  timelineErrorBoundary
} from '@/lib/services/timelines/request'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// The public, shareable feed of a collection (activities.next extension over
// the Mastodon profiles-only Collection). Unauthenticated: anyone can read a
// public/unlisted collection whose feed is enabled. Always serves the public
// projection (approved members ∩ public-visibility posts), so it is identical
// for every viewer and never leaks followers-only posts. 404 when the
// collection is missing, private, or has the feed disabled.
export const GET = traceApiRoute(
  'getPublicCollectionFeed',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read],
    timelineErrorBoundary(CORS_HEADERS, async (req, { database, params }) => {
      const { id } = await params
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
      const limit = parsedQuery.query.limit
      const maxStatusId = parsedQuery.query.maxStatusId
      const minStatusId =
        parsedQuery.query.minStatusId ?? parsedQuery.query.sinceStatusId

      const statuses = await database.getPublicCollectionTimeline({
        id,
        limit,
        maxStatusId,
        minStatusId
      })
      if (statuses === null) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const mastodonStatuses = await getMastodonStatuses(database, statuses)

      const host = headerHost(req.headers)
      const firstStatus = statuses[0]
      const lastStatus = statuses[statuses.length - 1]
      const nextLink = lastStatus
        ? `<https://${host}/api/v1/collections/${id}/feed?limit=${limit}&max_id=${urlToId(lastStatus.id)}>; rel="next"`
        : null
      const prevLink = firstStatus
        ? `<https://${host}/api/v1/collections/${id}/feed?limit=${limit}&min_id=${urlToId(firstStatus.id)}>; rel="prev"`
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')

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
  )
)
