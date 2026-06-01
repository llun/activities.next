import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  annotateMastodonStatusesWithFilters,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { normalizeTimelineLimit } from '@/lib/services/timelines/getFilteredTimelinePage'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

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
      const limitParam = url.searchParams.get('limit')
      const limit = normalizeTimelineLimit(
        limitParam ? parseInt(limitParam, 10) : PER_PAGE_LIMIT
      )
      const maxIdParam = url.searchParams.get('max_id')
      const minIdParam =
        url.searchParams.get('min_id') || url.searchParams.get('since_id')

      const statuses = await database.getListTimeline({
        listId,
        actorId: currentActor.id,
        limit,
        maxStatusId: maxIdParam ? idToUrl(maxIdParam) : null,
        minStatusId: minIdParam ? idToUrl(minIdParam) : null
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
      const lastStatus = statuses[statuses.length - 1]
      const nextLink = lastStatus
        ? `<https://${host}/api/v1/timelines/list/${listId}?limit=${limit}&max_id=${urlToId(lastStatus.id)}>; rel="next"`
        : null
      const links = [nextLink].filter(Boolean).join(', ')

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
