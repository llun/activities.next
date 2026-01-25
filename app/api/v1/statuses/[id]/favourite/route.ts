import { sendLike } from '@/lib/activities'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
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
  'favouriteStatus',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({
      statusId,
      withReplies: false,
      currentActorId: currentActor.id
    })
    if (!status) return apiErrorResponse(404)

    // Check if already liked to avoid duplicate activities
    const alreadyLiked =
      (status.type === 'Note' || status.type === 'Poll') && status.isActorLiked

    // Create like (database handles idempotency)
    await database.createLike({ actorId: currentActor.id, statusId })

    // Only send Like activity if not already liked
    if (!alreadyLiked) {
      await sendLike({ currentActor, status })
    }

    // Refetch status to get updated counts
    const updatedStatus = await database.getStatus({
      statusId,
      withReplies: false,
      currentActorId: currentActor.id
    })
    if (!updatedStatus) return apiErrorResponse(500)

    const mastodonStatus = await getMastodonStatus(
      database,
      updatedStatus,
      currentActor.id
    )
    if (!mastodonStatus) return apiErrorResponse(500)

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
