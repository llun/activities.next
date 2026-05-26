import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_403,
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
  'pinStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      // Check ownership - only owner can pin
      if (status.actorId !== currentActor.id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }

      await database.pinStatus({
        actorId: currentActor.id,
        statusId
      })

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor.id,
        { pinnedStatusIds: new Set([statusId]) }
      )
      if (!mastodonStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatus
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
