import { LikeStatus } from '@/lib/activities/actions/like'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/like'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'

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
        // Log error but don't fail the like operation
        console.error('Failed to send like notification email:', error)
      }
    }
  }
}
