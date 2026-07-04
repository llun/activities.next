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
        // Pass min_id and since_id through separately: min_id returns the page
        // immediately adjacent to the cursor (ascending seek then reversed),
        // since_id the newest slice above it.
        const statuses = await database.getListTimeline({
          listId,
          actorId: currentActor.id,
          limit,
          maxStatusId,
          minStatusId: parsedQuery.query.minStatusId,
          sinceStatusId: parsedQuery.query.sinceStatusId
        })

        // The list timeline query returns domain statuses newest-first, so the
        // last row is the next (older) page cursor and the first row is the
        // previous (newer) page cursor — mirroring the Mastodon Link headers
        // emitted below. Cursors are derived from the RAW page (before keyword
        // filtering) so that a page whose visible statuses are all keyword-hidden
        // still advances pagination to older posts instead of stopping early;
        // the hidden statuses still exist, so the cursor resolves on the next
        // fetch. (A keyword-heavy page may therefore return fewer than `limit`
        // visible statuses — a benign short page. Unlike the home feed, this
        // route does not run a backfill loop to refill the page; the client
        // simply makes one more request via the next cursor.)
        const nextMaxStatusId =
          statuses.length > 0 ? statuses[statuses.length - 1].id : null
        const prevMinStatusId = statuses.length > 0 ? statuses[0].id : null

        // List timelines use the same filtering context as the home timeline.
        const filterRecords = await getActiveFilters(
          database,
          currentActor.id,
          'home'
        )
        // Drop statuses matched by a `hide`-action keyword filter (parity with
        // the home feed). `warn` filters are not dropped — they are surfaced via
        // annotation on the Mastodon path below.
        const visibleStatuses = dropHideMatchesFromStatuses(
          statuses,
          filterRecords
        )

        // The Activities.next web UI consumes the internal domain Status shape
        // (the same payload as the home timeline's activities_next format) so
        // it can render with the shared <Posts> component. Default (no format)
        // stays Mastodon-compatible: entities + Link headers, untouched below.
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
    ),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
