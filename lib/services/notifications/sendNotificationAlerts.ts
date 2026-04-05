import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { shouldSendEmailForNotification } from './emailNotificationSettings'
import { sendPushNotification } from './pushNotification'

export interface EmailContent {
  recipientEmail: string
  subject: string
  text: string
  html: string
}

export interface NotificationEvent {
  type: NotificationType
  emailContent?: EmailContent
}

export interface SendNotificationAlertsParams {
  database: Database
  actorId: string
  sourceActorId: string
  sourceActor?: Actor
  statusId?: string
  events: NotificationEvent[]
}

/**
 * Dispatch notification alerts across all delivery channels.
 *
 * Callers provide one or more {@link NotificationEvent} items in priority
 * order.  The function fans out to every configured channel:
 *
 * - **Push** – one browser push for the *first* event (highest priority) to
 *   avoid duplicate pop-ups when a status triggers both reply and mention.
 * - **Email** – one email per event that carries {@link EmailContent}.
 * - *(future: phone, SMS, webhook …)*
 *
 * All delivery is fire-and-forget so it never blocks the caller.
 */
export const sendNotificationAlerts = (
  params: SendNotificationAlertsParams
): void => {
  const { database, actorId, sourceActorId, statusId, events } = params
  if (events.length === 0) return

  const resolveSourceActor = (): Promise<Actor | undefined | null> => {
    if (params.sourceActor) return Promise.resolve(params.sourceActor)
    return database.getActorFromId({ id: sourceActorId })
  }

  // --- Push notification (one per call, using the first / highest-priority event) ---
  const pushEvent = events[0]
  resolveSourceActor()
    .then((sourceActor) => {
      if (!sourceActor) return
      return sendPushNotification({
        database,
        actorId,
        type: pushEvent.type,
        sourceActor,
        statusId
      })
    })
    .catch((error) =>
      logger.error({
        message: `Failed to send ${pushEvent.type} push notification`,
        err: error
      })
    )

  // --- Email notifications (one per event that has emailContent) ---
  const config = getConfig()
  if (config.email) {
    for (const event of events) {
      if (!event.emailContent) continue
      const { emailContent } = event
      shouldSendEmailForNotification(database, actorId, event.type)
        .then((shouldSend) => {
          if (!shouldSend) return
          return sendMail({
            from: config.email!.serviceFromAddress,
            to: [emailContent.recipientEmail],
            subject: emailContent.subject,
            content: {
              text: emailContent.text,
              html: emailContent.html
            }
          })
        })
        .catch((error) =>
          logger.error({
            message: `Failed to send ${event.type} notification email`,
            err: error
          })
        )
    }
  }

  // --- Future channels (phone, SMS, webhook, …) can be added here ---
}
