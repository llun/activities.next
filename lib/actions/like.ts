import { LikeStatus } from '@/lib/activities/likeAction'
import { Database } from '@/lib/database/types'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/like'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'

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

    // Fire-and-forget: notification delivery must not fail the like action
    Promise.all([
      database.getActorFromId({ id: status.actorId }),
      database.getActorFromId({ id: request.actor })
    ])
      .then(([targetActor, sourceActor]) => {
        if (!sourceActor) return
        const editableStatus =
          status.type === 'Announce' ? status.originalStatus : status
        sendNotificationAlerts({
          database,
          actorId: status.actorId,
          sourceActorId: request.actor,
          sourceActor,
          statusId: status.id,
          events: [
            {
              type: NotificationType.enum.like,
              emailContent: targetActor?.account
                ? {
                    recipientEmail: targetActor.account.email,
                    subject: getSubject(sourceActor),
                    text: getTextContent(sourceActor, editableStatus),
                    html: getHTMLContent(sourceActor, editableStatus)
                  }
                : undefined
            }
          ]
        })
      })
      .catch(() => undefined)
  }
}
