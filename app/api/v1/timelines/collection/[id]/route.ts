import {
  annotateMastodonStatusesWithFilters,
  dropHideMatchesFromStatuses,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import {
  parseTimelineQuery,
  timelineErrorBoundary
} from '@/lib/services/timelines/request'
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

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// The collection owner's private feed (all members, owner visibility). Mirrors
// the list timeline: Mastodon entities + Link headers by default, or the
// activities.next domain shape when format=activities_next.
export const GET = traceApiRoute(
  'getCollectionTimeline',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    timelineErrorBoundary(
      CORS_HEADERS,
      async (req, { database, currentActor, params }) => {
        const { id } = await params
        const collection = await database.getCollection({
          id,
          actorId: currentActor.id
        })
        if (!collection) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }

        const url = new URL(req.url)
        const format = url.searchParams.get('format')
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

        const statuses = await database.getCollectionTimeline({
          id,
          actorId: currentActor.id,
          projection: 'owner',
          limit,
          maxStatusId,
          minStatusId
        })

        const nextMaxStatusId =
          statuses.length > 0 ? statuses[statuses.length - 1].id : null
        const prevMinStatusId = statuses.length > 0 ? statuses[0].id : null

        const filterRecords = await getActiveFilters(
          database,
          currentActor.id,
          'home'
        )
        const visibleStatuses = dropHideMatchesFromStatuses(
          statuses,
          filterRecords
        )

        if (format === TimelineFormat.enum.activities_next) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: {
              statuses: visibleStatuses.map((item) => cleanJson(item)),
              nextMaxStatusId,
              prevMinStatusId
            }
          })
        }

        const mastodonStatuses = await getMastodonStatuses(
          database,
          visibleStatuses,
          currentActor.id
        )
        const annotated = annotateMastodonStatusesWithFilters(
          mastodonStatuses,
          visibleStatuses,
          filterRecords
        )

        const host = headerHost(req.headers)
        const firstStatus = statuses[0]
        const lastStatus = statuses[statuses.length - 1]
        const nextLink = lastStatus
          ? `<https://${host}/api/v1/timelines/collection/${id}?limit=${limit}&max_id=${urlToId(lastStatus.id)}>; rel="next"`
          : null
        const prevLink = firstStatus
          ? `<https://${host}/api/v1/timelines/collection/${id}?limit=${limit}&min_id=${urlToId(firstStatus.id)}>; rel="prev"`
          : null
        const links = [nextLink, prevLink].filter(Boolean).join(', ')

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: annotated,
          additionalHeaders: [
            ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
          ]
        })
      }
    ),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
