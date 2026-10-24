import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow, rejectFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { Database } from '@/lib/database/types'
import { notifyLocalFollow } from '@/lib/services/notifications/notifyLocalFollow'
import { FollowStatus } from '@/lib/types/domain/follow'
import { actorIdsMatch } from '@/lib/utils/activitypub'

interface CreateFollowerParams {
  followRequest: FollowRequest
  recipientActorId?: string
  database: Database
}
export const createFollower = async ({
  followRequest,
  recipientActorId,
  database
}: CreateFollowerParams) => {
  let targetActor = await database.getActorFromId({
    id: followRequest.object
  })
  if (!targetActor && followRequest.object.endsWith('/')) {
    targetActor = await database.getActorFromId({
      id: followRequest.object.replace(/\/+$/, '')
    })
  }
  if (!targetActor) return null

  if (recipientActorId && !actorIdsMatch(targetActor.id, recipientActorId)) {
    return null
  }

  if (!targetActor.privateKey) {
    return null
  }

  const followerActor = await recordActorIfNeeded({
    actorId: followRequest.actor,
    database
  })
  if (!followerActor) {
    return null
  }

  if (
    await database.isEitherBlocking({
      actorIdA: followerActor.id,
      actorIdB: targetActor.id
    })
  ) {
    await rejectFollow(targetActor, followerActor.inboxUrl, followRequest)
    return followRequest
  }

  // Check if target actor requires manual approval for followers
  const settings = await database.getActorSettings({
    actorId: targetActor.id
  })
  const manuallyApprovesFollowers = settings?.manuallyApprovesFollowers ?? true

  const existingFollow =
    (await database.getAcceptedOrRequestedFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id
    })) ??
    (await database.getAcceptedOrRequestedFollow({
      actorId: followerActor.id.replace(/\/+$/, ''),
      targetActorId: targetActor.id.replace(/\/+$/, '')
    }))

  if (existingFollow) {
    if (existingFollow.status === FollowStatus.enum.Accepted) {
      await acceptFollow(targetActor, followerActor.inboxUrl, followRequest)
    }
    return followRequest
  }

  if (manuallyApprovesFollowers) {
    // Create follow with Requested status, don't auto-accept
    const follow = await database.createFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.enum.Requested,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    })

    await notifyLocalFollow({
      database,
      targetActor,
      followerActor,
      followId: follow.id,
      type: 'follow_request'
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
      notifyLocalFollow({
        database,
        targetActor,
        followerActor,
        followId: follow.id,
        type: 'follow'
      })
    ])
  }

  return followRequest
}
