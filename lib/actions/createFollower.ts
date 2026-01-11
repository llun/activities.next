import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'
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

  const followerActor = await recordActorIfNeeded({
    actorId: followRequest.actor,
    database
  })
  if (!followerActor) {
    return null
  }

  // Check if target actor requires manual approval for followers
  const settings = await database.getActorSettings({
    actorId: targetActor.id
  })
  const manuallyApprovesFollowers = settings?.manuallyApprovesFollowers ?? true

  if (manuallyApprovesFollowers) {
    // Create follow with Requested status, don't auto-accept
    const follow = await database.createFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.enum.Requested,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    })

    // Create follow_request notification
    await database.createNotification({
      actorId: targetActor.id,
      type: NotificationType.enum.follow_request,
      sourceActorId: followerActor.id,
      followId: follow.id
    })
  } else {
    // Auto-accept: create follow with Accepted status and send Accept activity
    const follow = await database.createFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.enum.Accepted,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    })

    await Promise.all([
      acceptFollow(targetActor, followerActor.inboxUrl, followRequest),
      // Create follow notification (auto-accepted)
      database.createNotification({
        actorId: targetActor.id,
        type: NotificationType.enum.follow,
        sourceActorId: followerActor.id,
        followId: follow.id
      })
    ])
  }

  return followRequest
}
