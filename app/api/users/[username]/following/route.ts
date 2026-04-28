import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFollowing',
  OnlyLocalUserGuard(async (database, actor, req) => {
    const followingId = `${actor.id}/following`
    const totalItems = await database.getActorFollowingCount({
      actorId: actor.id
    })
    return activityPubResponse({
      req,
      data: {
        '@context': ACTIVITY_STREAM_URL,
        id: followingId,
        type: 'OrderedCollection',
        totalItems
      }
    })
  })
)
