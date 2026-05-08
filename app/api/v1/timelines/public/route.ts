import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { filterBlockedStatuses } from '@/lib/services/timelines/blockFilter'
import { Timeline } from '@/lib/services/timelines/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

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
  const statuses = await filterBlockedStatuses(
    database,
    currentActor?.id,
    await database.getTimeline({
      timeline: Timeline.LOCAL_PUBLIC
    })
  )
  const mastodonStatuses = await Promise.all(
    statuses.map((status) => getMastodonStatus(database, status))
  )
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: mastodonStatuses.filter(Boolean)
  })
})
