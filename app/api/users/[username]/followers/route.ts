import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

export const GET = OnlyLocalUserGuard(async (database, actor) => {
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
