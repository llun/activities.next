import { annotateMastodonStatusesWithFilters } from '@/lib/services/filters/applyFilters'
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
import { Timeline } from '@/lib/services/timelines/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

type Params = Record<string, never>

export const GET = traceApiRoute(
  'getPublicTimeline',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read],
    async (req, context) => {
      const { database, currentActor } = context
      const url = new URL(req.url)
      const maxStatusIdParam = url.searchParams.get('max_id')
      const limitParam = url.searchParams.get('limit')
      const parsedLimit = limitParam ? parseInt(limitParam, 10) : null
      const pageLimit = normalizeTimelineLimit(parsedLimit)

      const { statuses, nextMaxStatusId, filterRecords } =
        await getFilteredStatusPage({
          database,
          actorId: currentActor?.id,
          maxStatusId: maxStatusIdParam ? idToUrl(maxStatusIdParam) : null,
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
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/timelines/public?limit=${pageLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: annotatedStatuses,
        additionalHeaders: [
          ...(nextLink ? [['Link', nextLink] as [string, string]] : [])
        ]
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
