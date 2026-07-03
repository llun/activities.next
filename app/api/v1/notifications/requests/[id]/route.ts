import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonNotificationRequest } from '@/lib/services/notifications/getMastodonNotificationRequest'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getNotificationRequest',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:notifications']],
    async (req, { currentActor, params }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const sourceActorId = idToUrl((await params).id)
      const request = await database.getNotificationRequest({
        actorId: currentActor.id,
        sourceActorId
      })
      if (!request) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const data = await getMastodonNotificationRequest(
        database,
        request,
        currentActor.id
      )
      if (!data) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)
