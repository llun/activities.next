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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const UNSUPPORTED_TIMELINE = [Timeline.LOCAL_PUBLIC]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  timeline: Timeline
}

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
    const url = new URL(req.url)
    const minStatusId =
      url.searchParams.get('since_id') || url.searchParams.get('min_id')
    const maxStatusId = url.searchParams.get('max_id')
    const limit = url.searchParams.get('limit')
    const format = url.searchParams.get('format')

    const { database, currentActor } = context
    const { timeline } = (await params?.params) ?? {}
    if (!timeline) return apiErrorResponse(400)

    if (
      !Object.values(Timeline).includes(timeline) ||
      UNSUPPORTED_TIMELINE.includes(timeline)
    ) {
      return apiErrorResponse(404)
    }

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
    const nextLink = `https://${host}/api/v1/timelines/${timeline}?limit=20&max_id=${encodeURIComponent(statuses[statuses.length - 1].id)}`
    const prevLink = `https://${host}/api/v1/timelines/${timeline}?limit=20&min_id=${encodeURIComponent(statuses[0].id)}`
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: await Promise.all(
        statuses.map((item) => getMastodonStatus(database, item))
      ),
      additionalHeaders: [
        ['Link', `<${nextLink}>; rel="next", <${prevLink}>; rel="prev`]
      ]
    })
  }
)
