import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { NotificationType } from '@/lib/types/database'
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
        if (config.email && account && status.actor) {
          try {
            // Check if email notifications are enabled for this notification type
            const shouldSendEmail = await shouldSendEmailForNotification(
              database,
              currentActor.id,
              NotificationType.enum.mention
            )

            if (shouldSendEmail) {
              await sendMail({
                from: config.email.serviceFromAddress,
                to: [account.email],
                subject: getSubject(status.actor),
                content: {
                  text: getTextContent(status),
                  html: getHTMLContent(status)
                }
              })
            }
          } catch (error) {
            // Log error but don't fail the mention operation
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Failed to send mention notification email'
            })
            span.recordException(
              error instanceof Error ? error : new Error(String(error))
            )
          }
        }
        span.end()
        return Timeline.MENTION
      }

      span.end()
      return null
    }
  )
