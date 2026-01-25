import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getUnreadNotificationsCount',
  OAuthGuard([Scope.enum.read], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const count = await database.getNotificationsCount({
      actorId: currentActor.id,
      onlyUnread: true
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { count }
    })
  })
)
