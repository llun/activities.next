import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'

export const GET = OnlyLocalUserGuard(async (storage, actor) => {
  const followingId = `${actor.id}/following`
  const totalItems = await storage.getActorFollowingCount({ actorId: actor.id })
  return Response.json({
    '@context': ACTIVITY_STREAM_URL,
    id: followingId,
    type: 'OrderedCollection',
    totalItems
  })
})
