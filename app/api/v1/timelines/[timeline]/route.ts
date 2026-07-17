import {
  annotateMastodonStatusesWithFilters,
  getFilterContextForTimeline
} from '@/lib/services/filters/applyFilters'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { getFilteredTimelinePage } from '@/lib/services/timelines/getFilteredTimelinePage'
import {
  parseTimelineQuery,
  timelineErrorBoundary
} from '@/lib/services/timelines/request'
import { Timeline } from '@/lib/services/timelines/types'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
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
const UNSUPPORTED_TIMELINE = [Timeline.LOCAL_PUBLIC]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  timeline: string
}

const isTimeline = (value: string): value is Timeline =>
  Object.values(Timeline).includes(value as Timeline)

export const GET = traceApiRoute(
  'getTimeline',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    timelineErrorBoundary(CORS_HEADERS, async (req, context) => {
      const url = new URL(req.url)
      const format = url.searchParams.get('format')

      const { database, currentActor, params } = context
      const { timeline } = await params
      if (!timeline)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })

      if (!isTimeline(timeline)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      if (UNSUPPORTED_TIMELINE.includes(timeline)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const parsedQuery = parseTimelineQuery(url.searchParams)
      if (!parsedQuery.ok) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      // Keep /api/v1/timelines/direct for Mastodon client compatibility.
      // The messages UI uses /api/v1/conversations for threaded direct messages.

      // Pass min_id and since_id through separately: min_id returns the page
      // immediately adjacent to the cursor (ascending seek then reversed),
      // since_id the newest slice above it. min_id wins when both are present.
      const pageLimit = parsedQuery.query.limit
      const maxStatusId = parsedQuery.query.maxStatusId
      const minStatusId = parsedQuery.query.minStatusId
      const sinceStatusId = parsedQuery.query.sinceStatusId

      const { statuses, nextMaxStatusId, prevMinStatusId, filterRecords } =
        await getFilteredTimelinePage({
          database,
          timeline,
          actorId: currentActor.id,
          minStatusId,
          sinceStatusId,
          maxStatusId,
          limit: pageLimit,
          filterContext: getFilterContextForTimeline(timeline),
          // The federated feed is a public surface: hide silenced authors too.
          // Home/direct/list feeds keep them (a follower still sees them).
          // LOCAL_PUBLIC — the other public surface — never reaches here (it is
          // 404'd via UNSUPPORTED_TIMELINE above); the dedicated
          // /timelines/public route serves it with surface: 'public'.
          surface:
            timeline === Timeline.FEDERATED_PUBLIC ? 'public' : 'following'
        })
      if (format === TimelineFormat.enum.activities_next) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: statuses.map((item) => cleanJson(item)),
            nextMaxStatusId,
            prevMinStatusId
          }
        })
      }

      const host = headerHost(req.headers)
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/timelines/${timeline}?limit=${pageLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      const prevLink = prevMinStatusId
        ? `<https://${host}/api/v1/timelines/${timeline}?limit=${pageLimit}&min_id=${urlToId(prevMinStatusId)}>; rel="prev"`
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor.id
      )
      const annotatedStatuses = annotateMastodonStatusesWithFilters(
        mastodonStatuses,
        statuses,
        filterRecords ?? []
      )

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
  ),
  {
    addAttributes: async (_req, context) => {
      const { timeline } = await context.params
      return { timeline }
    }
  }
)
