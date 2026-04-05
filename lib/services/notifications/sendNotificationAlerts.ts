import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { shouldSendEmailForNotification } from './emailNotificationSettings'
import { sendPushNotification } from './pushNotification'
import { shouldSendPushForNotification } from './pushNotificationSettings'

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
 * - **Push** – tries events in priority order, sends one browser push for the
 *   first event whose push setting is enabled.  This avoids duplicate pop-ups
 *   while still falling back (e.g. reply disabled → try mention).
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

  // --- Push notification ---
  // Try events in priority order; send for the first type the user has enabled.
  resolveSourceActor()
    .then(async (sourceActor) => {
      if (!sourceActor) return
      for (const event of events) {
        const shouldSend = await shouldSendPushForNotification(
          database,
          actorId,
          event.type
        )
        if (shouldSend) {
          await sendPushNotification({
            database,
            actorId,
            type: event.type,
            sourceActor,
            statusId
          })
          return
        }
      }
    })
    .catch((error) =>
      logger.error({
        message: 'Failed to send push notification',
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
