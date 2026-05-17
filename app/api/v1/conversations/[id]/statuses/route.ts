import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { normalizeTimelineLimit } from '@/lib/services/timelines/getFilteredTimelinePage'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getConversationStatuses',
  OAuthGuardAnyScope<Params>(
    [
      Scope.enum.read,
      Scope.enum['read:conversations'],
      Scope.enum['read:statuses']
    ],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const url = new URL(req.url)
      const limit = normalizeTimelineLimit(
        parseInt(url.searchParams.get('limit') || `${PER_PAGE_LIMIT}`, 10)
      )
      const minStatusIdParam =
        url.searchParams.get('since_id') || url.searchParams.get('min_id')
      const maxStatusIdParam = url.searchParams.get('max_id')
      const minStatusId = minStatusIdParam ? idToUrl(minStatusIdParam) : null
      const maxStatusId = maxStatusIdParam ? idToUrl(maxStatusIdParam) : null
      const statuses = await database.getDirectConversationStatuses({
        actorId: currentActor.id,
        conversationId: id,
        limit,
        minStatusId,
        maxStatusId
      })
      const nextMaxStatusId =
        statuses.length === limit ? statuses[statuses.length - 1].id : null
      const prevMinStatusId = statuses.length > 0 ? statuses[0].id : null

      if (
        url.searchParams.get('format') === TimelineFormat.enum.activities_next
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: statuses.map((status) => cleanJson(status)),
            nextMaxStatusId,
            prevMinStatusId
          }
        })
      }

      const host = headerHost(req.headers)
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/conversations/${id}/statuses?limit=${limit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      const prevLink = prevMinStatusId
        ? `<https://${host}/api/v1/conversations/${id}/statuses?limit=${limit}&min_id=${urlToId(prevMinStatusId)}>; rel="prev"`
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor.id
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)
