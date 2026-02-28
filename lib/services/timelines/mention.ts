import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { NotificationType } from '@/lib/types/database/operations'
import { getActorURL } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getTracer } from '@/lib/utils/trace'

import { MentionTimelineRule, Timeline } from './types'

export const mentionTimelineRule: MentionTimelineRule = async ({
  database,
  currentActor,
  status
}) =>
  getTracer().startActiveSpan(
    'timelines.mentionTimelineRule',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id
      }
    },
    async (span) => {
      const config = getConfig()
      if (status.type === StatusType.enum.Announce) {
        span.end()
        return null
      }

      if (status.actorId === currentActor.id) {
        span.end()
        return Timeline.MENTION
      }

      if (status.text.includes(getActorURL(currentActor))) {
        const account = currentActor.account
        const notificationPromises: Promise<unknown>[] = []

        if (config.email && account && status.actor) {
          notificationPromises.push(
            shouldSendEmailForNotification(
              database,
              currentActor.id,
              NotificationType.enum.mention
            ).then(async (shouldSendEmail) => {
              if (shouldSendEmail) {
                await sendMail({
                  from: config.email!.serviceFromAddress,
                  to: [account.email],
                  subject: getSubject(status.actor!),
                  content: {
                    text: getTextContent(status),
                    html: getHTMLContent(status)
                  }
                })
              }
            })
          )
        }

        if (!status.isLocalActor) {
          notificationPromises.push(
            database.createNotification({
              actorId: currentActor.id,
              type: NotificationType.enum.mention,
              sourceActorId: status.actorId,
              statusId: status.id,
              groupKey: `mention:${status.id}`
            })
          )
        }

        try {
          await Promise.all(notificationPromises)
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Failed to process mention notification'
          })
          span.recordException(
            error instanceof Error ? error : new Error(String(error))
          )
        }

        span.end()
        return Timeline.MENTION
      }

      span.end()
      return null
    }
  )
