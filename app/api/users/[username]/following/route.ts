import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFollowing',
  OnlyLocalUserGuard(async (database, actor) => {
    const followingId = `${actor.id}/following`
    const totalItems = await database.getActorFollowingCount({
      actorId: actor.id
    })
    return Response.json({
      '@context': ACTIVITY_STREAM_URL,
      id: followingId,
      type: 'OrderedCollection',
      totalItems
    })
  })
)
