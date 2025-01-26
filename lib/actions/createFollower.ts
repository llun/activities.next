import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow, getPublicProfile } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { Storage } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'

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
      status: FollowStatus.enum.Accepted,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    }),
    acceptFollow(targetActor, followerActor.inboxUrl, followRequest)
  ])

  return followRequest
}
