import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow, getPublicProfile } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'

interface CreateFollowerParams {
  followRequest: FollowRequest
  database: Database
}
export const createFollower = async ({
  followRequest,
  database
}: CreateFollowerParams) => {
  const targetActor = await database.getActorFromId({
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
    database
  })
  if (!followerActor) {
    return null
  }

  await Promise.all([
    database.createFollow({
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
