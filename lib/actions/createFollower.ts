import { recordActorIfNeeded } from '@/lib/actions/utils'
import { acceptFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'
import { FollowStatus } from '@/lib/models/follow'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'

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

    // Send email notification for follow request (best-effort)
    const config = getConfig()
    if (config.email) {
      try {
        const shouldSendEmail = await shouldSendEmailForNotification(
          database,
          targetActor.id,
          NotificationType.enum.follow_request
        )

        if (shouldSendEmail && targetActor.account) {
          await sendMail({
            from: config.email.serviceFromAddress,
            to: [targetActor.account.email],
            subject: getSubject(followerActor),
            content: {
              text: getTextContent(followerActor),
              html: getHTMLContent(followerActor)
            }
          })
        }
      } catch (error) {
        console.error('Failed to send follow request notification email:', error)
      }
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

    // Send email notification for auto-accepted follow (best-effort)
    const config = getConfig()
    if (config.email) {
      try {
        const shouldSendEmail = await shouldSendEmailForNotification(
          database,
          targetActor.id,
          NotificationType.enum.follow
        )

        if (shouldSendEmail && targetActor.account) {
          await sendMail({
            from: config.email.serviceFromAddress,
            to: [targetActor.account.email],
            subject: getSubject(followerActor),
            content: {
              text: getTextContent(followerActor),
              html: getHTMLContent(followerActor)
            }
          })
        }
      } catch (error) {
        console.error('Failed to send follow notification email:', error)
      }
    }
  }

  return followRequest
}
