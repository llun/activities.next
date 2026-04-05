import { LikeStatus } from '@/lib/activities/likeAction'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/like'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { sendPushNotification } from '@/lib/services/notifications/pushNotification'
import { NotificationType } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

interface LikeRequestParams {
  activity: LikeStatus
  database: Database
}

export const likeRequest = async ({
  activity,
  database
}: LikeRequestParams) => {
  const request = activity as LikeStatus
  const statusId =
    typeof request.object === 'string' ? request.object : request.object.id

  await database.createLike({
    statusId,
    actorId: request.actor
  })

  // Create like notification
  const status = await database.getStatus({ statusId })
  if (status && status.actorId !== request.actor) {
    await database.createNotification({
      actorId: status.actorId,
      type: NotificationType.enum.like,
      sourceActorId: request.actor,
      statusId: status.id,
      groupKey: `like:${status.id}`
    })

    // Send email notification (best-effort, don't fail like if email fails)
    const config = getConfig()
    if (config.email) {
      try {
        // Check if email notifications are enabled for this notification type
        const shouldSendEmail = await shouldSendEmailForNotification(
          database,
          status.actorId,
          NotificationType.enum.like
        )

        if (shouldSendEmail) {
          const [targetActor, sourceActor] = await Promise.all([
            database.getActorFromId({ id: status.actorId }),
            database.getActorFromId({ id: request.actor })
          ])

          if (targetActor?.account && sourceActor) {
            // Extract editable status (handle Announce type)
            const editableStatus =
              status.type === 'Announce' ? status.originalStatus : status

            await sendMail({
              from: config.email.serviceFromAddress,
              to: [targetActor.account.email],
              subject: getSubject(sourceActor),
              content: {
                text: getTextContent(sourceActor, editableStatus),
                html: getHTMLContent(sourceActor, editableStatus)
              }
            })
          }
        }
      } catch (error) {
        logger.error({
          message: 'Failed to send like notification email',
          err: error
        })
      }
    }

    // Send push notification (best-effort, fire-and-forget)
    database
      .getActorFromId({ id: request.actor })
      .then((sourceActor) => {
        if (!sourceActor) return
        return sendPushNotification({
          database,
          actorId: status.actorId,
          type: NotificationType.enum.like,
          sourceActor,
          statusId: status.id
        })
      })
      .catch((error) =>
        logger.error({
          message: 'Failed to send like push notification',
          err: error
        })
      )
  }
}
