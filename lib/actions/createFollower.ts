import { acceptFollow } from '../activities'
import { FollowRequest } from '../activities/actions/follow'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'

interface CreateFollowerParams {
  followRequest: FollowRequest
  storage: Storage
}
export const createFollower = async ({
  followRequest,
  storage
}: CreateFollowerParams) => {
  const actor = await storage.getActorFromId({
    id: followRequest.object
  })
  if (!actor) return null

  await Promise.all([
    await storage.createFollow({
      actorId: followRequest.actor,
      targetActorId: followRequest.object,
      status: FollowStatus.Accepted
    }),
    await acceptFollow(actor, followRequest)
  ])
  return followRequest
}
