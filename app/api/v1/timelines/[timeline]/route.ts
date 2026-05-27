import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import {
  getFilteredTimelinePage,
  normalizeTimelineLimit
} from '@/lib/services/timelines/getFilteredTimelinePage'
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
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

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
    async (req, context) => {
      const url = new URL(req.url)
      const minStatusIdParam =
        url.searchParams.get('since_id') || url.searchParams.get('min_id')
      const maxStatusIdParam = url.searchParams.get('max_id')
      const limit = url.searchParams.get('limit')
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

      // Keep /api/v1/timelines/direct for Mastodon client compatibility.
      // The messages UI uses /api/v1/conversations for threaded direct messages.

      const minStatusId = minStatusIdParam ? idToUrl(minStatusIdParam) : null
      const maxStatusId = maxStatusIdParam ? idToUrl(maxStatusIdParam) : null
      const parsedLimit = limit ? parseInt(limit, 10) : PER_PAGE_LIMIT
      const pageLimit = normalizeTimelineLimit(parsedLimit)

      const { statuses, nextMaxStatusId, prevMinStatusId } =
        await getFilteredTimelinePage({
          database,
          timeline,
          actorId: currentActor.id,
          minStatusId,
          maxStatusId,
          limit: pageLimit
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

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const { timeline } = await context.params
      return { timeline }
    }
  }
)
