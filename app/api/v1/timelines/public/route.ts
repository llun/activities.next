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
      const { local, remote } = parsedQuery.query

      // Mastodon scope: local=true → local only, remote=true → federated only,
      // neither (default) → the federated view (local + relay-sourced remote).
      const fetchBatch =
        local && !remote
          ? ({
              maxStatusId,
              limit
            }: {
              maxStatusId: string | null
              limit: number
            }) =>
              database.getTimeline({
                timeline: Timeline.LOCAL_PUBLIC,
                maxStatusId,
                limit
              })
          : remote && !local
            ? ({
                maxStatusId,
                limit
              }: {
                maxStatusId: string | null
                limit: number
              }) =>
                database.getTimeline({
                  timeline: Timeline.FEDERATED_PUBLIC,
                  maxStatusId,
                  limit
                })
            : async ({
                maxStatusId,
                limit
              }: {
                maxStatusId: string | null
                limit: number
              }) => {
                const [localStatuses, remoteStatuses] = await Promise.all([
                  database.getTimeline({
                    timeline: Timeline.LOCAL_PUBLIC,
                    maxStatusId,
                    limit
                  }),
                  database.getTimeline({
                    timeline: Timeline.FEDERATED_PUBLIC,
                    maxStatusId,
                    limit
                  })
                ])
                return mergePublicStatuses(localStatuses, remoteStatuses, limit)
              }

      const { statuses, nextMaxStatusId, filterRecords } =
        await getFilteredStatusPage({
          database,
          actorId: currentActor?.id,
          maxStatusId: parsedQuery.query.maxStatusId,
          limit: pageLimit,
          filterContext: currentActor ? 'public' : undefined,
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
      // Only `next` (older) is emitted: the public timeline query pages forward
      // by `max_id` only and has no lower-bound cursor, so a `prev`/`min_id`
      // link would not actually page to newer statuses.
      const scopeParam = local && !remote ? '&local=true' : ''
      const remoteScopeParam = remote && !local ? '&remote=true' : ''
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/timelines/public?limit=${pageLimit}&max_id=${urlToId(nextMaxStatusId)}${scopeParam}${remoteScopeParam}>; rel="next"`
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
