import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'

export const GET = OnlyLocalUserGuard(async (database, actor) => {
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
