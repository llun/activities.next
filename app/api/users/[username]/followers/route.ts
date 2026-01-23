import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFollowers',
  OnlyLocalUserGuard(async (database, actor) => {
    const followerId = `${actor.id}/followers`

    const totalItems = await database.getActorFollowersCount({
      actorId: actor.id
    })
    return Response.json({
      '@context': ACTIVITY_STREAM_URL,
      id: followerId,
      type: 'OrderedCollection',
      totalItems
    })
  })
)
