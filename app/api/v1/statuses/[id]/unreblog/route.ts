import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
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
  'unreblogStatus',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
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
    let undoStatusId = statusId
    const readableStatus = await getReadableStatus({
      database,
      statusId,
      currentActor,
      withReplies: false
    })
    if (
      readableStatus?.type !== StatusType.enum.Announce ||
      readableStatus.actorId !== currentActor.id
    ) {
      const actorAnnounce = await database.getActorAnnounceStatus({
        actorId: currentActor.id,
        statusId
      })

      if (!actorAnnounce && !readableStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      undoStatusId = actorAnnounce?.id ?? statusId
    }

    const undoStatus = await userUndoAnnounce({
      currentActor,
      statusId: undoStatusId,
      database
    })

    if (!undoStatus) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const mastodonStatus = await getMastodonStatus(
      database,
      undoStatus,
      currentActor.id
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
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
