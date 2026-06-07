import { annotateMastodonStatusesWithFilters } from '@/lib/services/filters/applyFilters'
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
import { Timeline } from '@/lib/services/timelines/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

type Params = Record<string, never>

export const GET = traceApiRoute(
  'getPublicTimeline',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read],
    timelineErrorBoundary(CORS_HEADERS, async (req, context) => {
      const { database, currentActor } = context
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
      const pageLimit = parsedQuery.query.limit

      const { statuses, nextMaxStatusId, filterRecords } =
        await getFilteredStatusPage({
          database,
          actorId: currentActor?.id,
          maxStatusId: parsedQuery.query.maxStatusId,
          limit: pageLimit,
          filterContext: currentActor ? 'public' : undefined,
          fetchBatch: ({ maxStatusId, limit }) =>
            database.getTimeline({
              timeline: Timeline.LOCAL_PUBLIC,
              maxStatusId,
              limit
            })
        })
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor?.id
      )
      const annotatedStatuses = annotateMastodonStatusesWithFilters(
        mastodonStatuses,
        statuses,
        filterRecords ?? []
      )
      const host = headerHost(req.headers)
      // Only `next` (older) is emitted: the public timeline query pages forward
      // by `max_id` only and has no lower-bound cursor, so a `prev`/`min_id`
      // link would not actually page to newer statuses.
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/timelines/public?limit=${pageLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      const links = [nextLink].filter(Boolean).join(', ')
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: annotatedStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
