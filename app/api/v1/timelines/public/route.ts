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
import { Status } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Merge local-public and federated (relay-sourced) statuses into one page,
// newest first, matching getTimeline's (createdAt, id) ordering. The two
// sources are disjoint by author locality, but dedupe by id defensively.
const mergePublicStatuses = (
  local: Status[],
  remote: Status[],
  limit: number
): Status[] => {
  const byId = new Map<string, Status>()
  for (const status of [...local, ...remote]) byId.set(status.id, status)
  return [...byId.values()]
    .sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
      if (a.id === b.id) return 0
      return a.id < b.id ? 1 : -1
    })
    .slice(0, limit)
}

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
      const { local, remote, onlyMedia, maxStatusId } = parsedQuery.query
      // `min_id` and `since_id` both express a lower-bound cursor; the timeline
      // query takes a single min cursor, so collapse them with `min_id`-wins
      // precedence (matching the list/collection timelines). Both return the
      // newest page above the bound, like every other timeline route here.
      const minStatusId =
        parsedQuery.query.minStatusId ?? parsedQuery.query.sinceStatusId

      const queryTimeline =
        (timeline: Timeline) =>
        ({
          maxStatusId: cursor,
          limit
        }: {
          maxStatusId: string | null
          limit: number
        }) =>
          database.getTimeline({
            timeline,
            maxStatusId: cursor,
            minStatusId,
            onlyMedia,
            limit
          })

      // Mastodon scope: local=true → local only, remote=true → federated only,
      // neither (default) → the federated view (local + relay-sourced remote).
      const fetchBatch =
        local && !remote
          ? queryTimeline(Timeline.LOCAL_PUBLIC)
          : remote && !local
            ? queryTimeline(Timeline.FEDERATED_PUBLIC)
            : async (batch: { maxStatusId: string | null; limit: number }) => {
                const [localStatuses, remoteStatuses] = await Promise.all([
                  queryTimeline(Timeline.LOCAL_PUBLIC)(batch),
                  queryTimeline(Timeline.FEDERATED_PUBLIC)(batch)
                ])
                return mergePublicStatuses(
                  localStatuses,
                  remoteStatuses,
                  batch.limit
                )
              }

      const { statuses, nextMaxStatusId, prevMinStatusId, filterRecords } =
        await getFilteredStatusPage({
          database,
          actorId: currentActor?.id,
          maxStatusId,
          limit: pageLimit,
          // Applied unconditionally so instance-wide server filters reach
          // signed-out viewers too (getActiveFilters returns only server
          // filters when actorId is undefined), per REVIEW.md's cross-view
          // filtering invariant — matching the anon status detail/context views.
          filterContext: 'public',
          fetchBatch
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
      const linkBaseParams = new URLSearchParams()
      linkBaseParams.set('limit', `${pageLimit}`)
      if (local && !remote) linkBaseParams.set('local', 'true')
      if (remote && !local) linkBaseParams.set('remote', 'true')
      if (onlyMedia) linkBaseParams.set('only_media', 'true')
      const buildLink = (
        cursorName: 'max_id' | 'min_id',
        cursorValue: string
      ) => {
        const linkParams = new URLSearchParams(linkBaseParams)
        linkParams.set(cursorName, urlToId(cursorValue))
        const rel = cursorName === 'max_id' ? 'next' : 'prev'
        return `<https://${host}/api/v1/timelines/public?${linkParams.toString()}>; rel="${rel}"`
      }
      const nextLink = nextMaxStatusId
        ? buildLink('max_id', nextMaxStatusId)
        : null
      const prevLink = prevMinStatusId
        ? buildLink('min_id', prevMinStatusId)
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')
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
