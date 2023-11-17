import { ACTIVITY_STREAM_URL } from '../../../../../lib/jsonld/activitystream'
import { OnlyLocalUserGuard } from '../guard'

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
