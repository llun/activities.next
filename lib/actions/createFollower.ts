import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow, rejectFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { Database } from '@/lib/database/types'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { buildFollowRequestEmail } from '@/lib/services/email/templates/followRequest'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { followGroupKey } from '@/lib/services/notifications/followGrouping'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'
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

    // Create follow_request notification; only send alerts if accepted.
    const followRequestNotification = await createNotificationWithPolicy(
      database,
      {
        actorId: targetActor.id,
        type: NotificationType.enum.follow_request,
        sourceActorId: followerActor.id,
        followId: follow.id
      }
    )

    if (followRequestNotification && !followRequestNotification.filtered) {
      sendNotificationAlerts({
        database,
        actorId: targetActor.id,
        sourceActorId: followerActor.id,
        sourceActor: followerActor,
        events: [
          {
            type: NotificationType.enum.follow_request,
            notificationId: followRequestNotification?.id,
            emailContent: targetActor.account
              ? {
                  recipientEmail: targetActor.account.email,
                  ...buildFollowRequestEmail({
                    recipient: targetActor,
                    actor: followerActor
                  })
                }
              : undefined
          }
        ]
      })
    }
  } else {
    // Auto-accept: create follow with Accepted status and send Accept activity
    const follow = await database.createFollow({
      actorId: followerActor.id,
      targetActorId: targetActor.id,
      status: FollowStatus.enum.Accepted,
      inbox: followerActor.inboxUrl,
      sharedInbox: followerActor.sharedInboxUrl
    })

    const [, followNotification] = await Promise.all([
      acceptFollow(targetActor, followerActor.inboxUrl, followRequest),
      // Create follow notification (auto-accepted). Bucket follows by UTC day so
      // they group within a bounded window instead of one ever-growing group.
      createNotificationWithPolicy(database, {
        actorId: targetActor.id,
        type: NotificationType.enum.follow,
        sourceActorId: followerActor.id,
        followId: follow.id,
        groupKey: followGroupKey(Date.now())
      })
    ])

    if (followNotification && !followNotification.filtered) {
      sendNotificationAlerts({
        database,
        actorId: targetActor.id,
        sourceActorId: followerActor.id,
        sourceActor: followerActor,
        events: [
          {
            type: NotificationType.enum.follow,
            notificationId: followNotification?.id,
            emailContent: targetActor.account
              ? {
                  recipientEmail: targetActor.account.email,
                  ...buildFollowEmail({
                    recipient: targetActor,
                    actor: followerActor
                  })
                }
              : undefined
          }
        ]
      })
    }
  }

  return followRequest
}
