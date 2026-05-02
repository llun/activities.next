import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardHandle
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { AppRouterParams } from '@/lib/services/guards/types'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { StatusType } from '@/lib/types/domain/status'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type StatusLikesParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

const ACTIVITYPUB_LIKES_LIMIT = 100

export const GET = traceApiRoute(
  'getActorStatusLikes',
  OnlyLocalUserGuard(async (database, actor, req, query: unknown) => {
    const { statusId } = await (query as AppRouterParams<StatusLikesParams>)
      .params
    const id = getLocalStatusId({ actorId: actor.id, statusId })
    const status = await database.getStatus({
      statusId: id,
      withReplies: false
    })
    if (!status) return apiErrorResponse(404)
    if (!isStatusPubliclyReadable(status)) return apiErrorResponse(404)
    if (status.type === StatusType.enum.Announce) return apiErrorResponse(404)

    const [likedBy, totalItems] = await Promise.all([
      database.getFavouritedBy({
        statusId: status.id,
        limit: ACTIVITYPUB_LIKES_LIMIT
      }),
      database.getLikeCount({ statusId: status.id })
    ])

    return activityPubResponse({
      req,
      data: {
        '@context': ACTIVITY_STREAM_URL,
        id: `${status.id}/likes`,
        type: 'Collection',
        totalItems,
        items: likedBy.map((likedByActor) => likedByActor.id)
      }
    })
  })
)
