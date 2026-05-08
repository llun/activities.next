import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import {
  getFilteredStatusPage,
  normalizeTimelineLimit
} from '@/lib/services/timelines/getFilteredTimelinePage'
import { Timeline } from '@/lib/services/timelines/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('getPublicTimeline', async (req) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: 500
    })
  }

  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)
  const url = new URL(req.url)
  const maxStatusIdParam = url.searchParams.get('max_id')
  const limitParam = url.searchParams.get('limit')
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : null
  const pageLimit = normalizeTimelineLimit(parsedLimit)

  const { statuses, nextMaxStatusId } = await getFilteredStatusPage({
    database,
    actorId: currentActor?.id,
    maxStatusId: maxStatusIdParam ? idToUrl(maxStatusIdParam) : null,
    limit: pageLimit,
    fetchBatch: ({ maxStatusId, limit }) =>
      database.getTimeline({
        timeline: Timeline.LOCAL_PUBLIC,
        maxStatusId,
        limit
      })
  })
  const mastodonStatuses = await Promise.all(
    statuses.map((status) =>
      getMastodonStatus(database, status, currentActor?.id)
    )
  )
  const host = headerHost(req.headers)
  const nextLink = nextMaxStatusId
    ? `<https://${host}/api/v1/timelines/public?limit=${pageLimit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
    : null
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: mastodonStatuses.filter(Boolean),
    additionalHeaders: [
      ...(nextLink ? [['Link', nextLink] as [string, string]] : [])
    ]
  })
})
