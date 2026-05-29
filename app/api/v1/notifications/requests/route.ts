import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonNotificationRequest } from '@/lib/services/notifications/getMastodonNotificationRequest'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getNotificationRequests',
  OAuthGuard([Scope.enum.read], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const url = new URL(req.url)
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10),
      MAX_LIMIT
    )
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const requests = await database.getNotificationRequests({
      actorId: currentActor.id,
      limit,
      offset
    })

    const data = (
      await Promise.all(
        requests.map((request) =>
          getMastodonNotificationRequest(database, request, currentActor.id)
        )
      )
    ).filter(Boolean)

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)
