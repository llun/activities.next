import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
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
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const url = new URL(req.url)
    const minStatusIdParam =
      url.searchParams.get('since_id') || url.searchParams.get('min_id')
    const maxStatusIdParam = url.searchParams.get('max_id')
    const limit = url.searchParams.get('limit')
    const format = url.searchParams.get('format')

    const { database, currentActor, params } = context
    const { timeline } = await params
    if (!timeline) return apiErrorResponse(400)

    if (!isTimeline(timeline)) {
      return apiErrorResponse(404)
    }

    if (UNSUPPORTED_TIMELINE.includes(timeline)) {
      return apiErrorResponse(404)
    }

    const minStatusId = minStatusIdParam ? idToUrl(minStatusIdParam) : null
    const maxStatusId = maxStatusIdParam ? idToUrl(maxStatusIdParam) : null

    const statuses = await database.getTimeline({
      timeline,
      actorId: currentActor.id,
      minStatusId,
      maxStatusId,
      limit: limit ? parseInt(limit, 10) : PER_PAGE_LIMIT
    })
    if (format === TimelineFormat.enum.activities_next) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          statuses: statuses.map((item) => cleanJson(item))
        }
      })
    }

    const host = headerHost(req.headers)
    const nextLink =
      statuses.length > 0
        ? `<https://${host}/api/v1/timelines/${timeline}?limit=20&max_id=${urlToId(statuses[statuses.length - 1].id)}>; rel="next"`
        : null
    const prevLink =
      statuses.length > 0
        ? `<https://${host}/api/v1/timelines/${timeline}?limit=20&min_id=${urlToId(statuses[0].id)}>; rel="prev"`
        : null
    const links = [nextLink, prevLink].filter(Boolean).join(', ')
    const mastodonStatuses = await Promise.all(
      statuses.map((item) => getMastodonStatus(database, item, currentActor.id))
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatuses.filter(Boolean),
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const { timeline } = await context.params
      return { timeline }
    }
  }
)
