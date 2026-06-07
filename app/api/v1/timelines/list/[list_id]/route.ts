import {
  annotateMastodonStatusesWithFilters,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
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
  list_id: string
}

// https://docs.joinmastodon.org/methods/timelines/#list
export const GET = traceApiRoute(
  'getListTimeline',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:lists']],
    timelineErrorBoundary(
      CORS_HEADERS,
      async (req, { database, currentActor, params }) => {
        const { list_id: listId } = await params
        const list = await database.getList({
          id: listId,
          actorId: currentActor.id
        })
        if (!list) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }

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
        // `min_id` and `since_id` both express a lower-bound cursor; the list
        // timeline query takes a single min cursor, so collapse them preserving
        // this route's existing `min_id`-wins precedence. (min/since ordering
        // semantics are unchanged by this PR — see PR notes.)
        const minStatusId =
          parsedQuery.query.minStatusId ?? parsedQuery.query.sinceStatusId

        const statuses = await database.getListTimeline({
          listId,
          actorId: currentActor.id,
          limit,
          maxStatusId,
          minStatusId
        })

        const mastodonStatuses = await getMastodonStatuses(
          database,
          statuses,
          currentActor.id
        )
        // List timelines use the same filtering context as the home timeline.
        const filterRecords = await getActiveFilters(
          database,
          currentActor.id,
          'home'
        )
        const annotated = annotateMastodonStatusesWithFilters(
          mastodonStatuses,
          statuses,
          filterRecords
        )

        const host = headerHost(req.headers)
        const firstStatus = statuses[0]
        const lastStatus = statuses[statuses.length - 1]
        const nextLink = lastStatus
          ? `<https://${host}/api/v1/timelines/list/${listId}?limit=${limit}&max_id=${urlToId(lastStatus.id)}>; rel="next"`
          : null
        const prevLink = firstStatus
          ? `<https://${host}/api/v1/timelines/list/${listId}?limit=${limit}&min_id=${urlToId(firstStatus.id)}>; rel="prev"`
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
    )
  )
)
