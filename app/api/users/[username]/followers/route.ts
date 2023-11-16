import { OnlyLocalUserGuard } from '../guard'

export const GET = OnlyLocalUserGuard(async (storage, actor) => {
  const followerId = `${actor.id}/followers`

  const totalItems = await storage.getActorFollowersCount({ actorId: actor.id })
  return Response.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followerId,
    type: 'OrderedCollection',
    totalItems
  })
})
