import { sendUndoLike } from '@/lib/activities'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_500,
  apiCorsError,
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
  'unfavouriteStatus',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

    const statusId = idToUrl(encodedStatusId)
    let status = await getReadableStatus({
      database,
      statusId,
      currentActor,
      withReplies: false
    })
    if (!status) {
      const isActorLikedStatus = await database.isActorLikedStatus({
        actorId: currentActor.id,
        statusId
      })
      if (!isActorLikedStatus) return apiCorsError(req, CORS_HEADERS, 404)

      status = await database.getStatus({
        statusId,
        withReplies: false,
        currentActorId: currentActor.id
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)
    }

    await database.deleteLike({ actorId: currentActor.id, statusId })
    await sendUndoLike({ currentActor, status })

    // Refetch status to get updated counts
    const updatedStatus = await database.getStatus({
      statusId,
      withReplies: false,
      currentActorId: currentActor.id
    })
    if (!updatedStatus)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })

    const mastodonStatus = await getMastodonStatus(
      database,
      updatedStatus,
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
