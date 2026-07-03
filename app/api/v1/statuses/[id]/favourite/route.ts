import { sendLike } from '@/lib/activities'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { refetchedStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'favouriteStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:favourites']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      // Check if already liked to avoid duplicate activities
      const alreadyLiked =
        (status.type === 'Note' || status.type === 'Poll') &&
        status.isActorLiked

      // Create like (database handles idempotency)
      await database.createLike({ actorId: currentActor.id, statusId })

      // Only send Like activity if not already liked
      if (!alreadyLiked) {
        await sendLike({ currentActor, status })
      }

      // Refetch status to get updated counts
      return refetchedStatusResponse({
        req,
        database,
        currentActor,
        statusId,
        allowedMethods: CORS_HEADERS
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
