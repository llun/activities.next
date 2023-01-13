import { acceptFollow, getPublicProfile } from '../activities'
import { FollowRequest } from '../activities/actions/follow'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'
import { recordActorIfNeeded } from './utils'

interface CreateFollowerParams {
  followRequest: FollowRequest
  storage: Storage
}
export const createFollower = async ({
  followRequest,
  storage
}: CreateFollowerParams) => {
  const targetActor = await storage.getActorFromId({
    id: followRequest.object
  })
  if (!targetActor) return null

  const person = await getPublicProfile({
    actorId: followRequest.actor,
    withPublicKey: true
  })
  if (!person) return null

  const followerActor = await recordActorIfNeeded({
    actorId: followRequest.actor,
    storage
  })
  if (!followerActor) {
    return null
  }

  await Promise.all([
    storage.createFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.Accepted,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    }),
    acceptFollow(targetActor, followerActor.inboxUrl, followRequest)
  ])

  return followRequest
}
