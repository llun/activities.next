import { OnlyLocalUserGuard } from '../guard'

export const GET = OnlyLocalUserGuard(async (storage, actor) => {
  const followingId = `${actor.id}/following`
  const totalItems = await storage.getActorFollowingCount({ actorId: actor.id })
  return Response.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followingId,
    type: 'OrderedCollection',
    totalItems
  })
})
