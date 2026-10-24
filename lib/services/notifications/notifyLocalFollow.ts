import { Database } from '@/lib/database/types'
import { resolveActorEmailBrand } from '@/lib/services/email/sender'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { buildFollowRequestEmail } from '@/lib/services/email/templates/followRequest'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { followGroupKey } from '@/lib/services/notifications/followGrouping'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { Notification, NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

export interface NotifyLocalFollowParams {
  database: Database
  targetActor: Actor
  followerActor: Actor
  followId: string
  type: 'follow' | 'follow_request'
}

/**
 * Creates a follow or follow_request notification for a local target actor,
 * applying the recipient's notification policy and sending push and email alerts.
 */
export const notifyLocalFollow = async ({
  database,
  targetActor,
  followerActor,
  followId,
  type
}: NotifyLocalFollowParams): Promise<Notification | null> => {
  const isFollow = type === 'follow'
  const notification = await createNotificationWithPolicy(database, {
    actorId: targetActor.id,
    type: isFollow
      ? NotificationType.enum.follow
      : NotificationType.enum.follow_request,
    sourceActorId: followerActor.id,
    followId,
    ...(isFollow ? { groupKey: followGroupKey(Date.now()) } : {})
  })

  if (notification && !notification.filtered) {
    sendNotificationAlerts({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: isFollow
            ? NotificationType.enum.follow
            : NotificationType.enum.follow_request,
          notificationId: notification.id,
          emailContent: targetActor.account
            ? {
                recipientEmail: targetActor.account.email,
                ...(isFollow
                  ? buildFollowEmail({
                      recipient: targetActor,
                      brand: await resolveActorEmailBrand(
                        database,
                        targetActor
                      ),
                      actor: followerActor
                    })
                  : buildFollowRequestEmail({
                      recipient: targetActor,
                      brand: await resolveActorEmailBrand(
                        database,
                        targetActor
                      ),
                      actor: followerActor
                    }))
              }
            : undefined
        }
      ]
    })
  }

  return notification
}
