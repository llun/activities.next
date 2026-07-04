import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'dismissNotificationRequest',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:notifications']],
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

      await database.dismissNotificationRequests({
        actorId: currentActor.id,
        sourceActorIds: [sourceActorId]
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
