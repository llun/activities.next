import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { Database } from '@/lib/database/types'
import {
  getHTMLContent as getFollowHTMLContent,
  getSubject as getFollowSubject,
  getTextContent as getFollowTextContent
} from '@/lib/services/email/templates/follow'
import {
  getHTMLContent as getFollowRequestHTMLContent,
  getSubject as getFollowRequestSubject,
  getTextContent as getFollowRequestTextContent
} from '@/lib/services/email/templates/followRequest'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'

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

    sendNotificationAlerts({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: NotificationType.enum.follow_request,
          emailContent: targetActor.account
            ? {
                recipientEmail: targetActor.account.email,
                subject: getFollowRequestSubject(followerActor),
                text: getFollowRequestTextContent(followerActor),
                html: getFollowRequestHTMLContent(followerActor)
              }
            : undefined
        }
      ]
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

    sendNotificationAlerts({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: NotificationType.enum.follow,
          emailContent: targetActor.account
            ? {
                recipientEmail: targetActor.account.email,
                subject: getFollowSubject(followerActor),
                text: getFollowTextContent(followerActor),
                html: getFollowHTMLContent(followerActor)
              }
            : undefined
        }
      ]
    })
  }

  return followRequest
}
