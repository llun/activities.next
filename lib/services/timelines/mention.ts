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
import { TagType } from '@/lib/types/domain/tag'
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

      const mentionTags = await database.getTags({ statusId: status.id })
      const isMentioned = mentionTags.some(
        (tag) =>
          tag.type === TagType.enum.mention &&
          (tag.value === currentActor.id ||
            tag.value === getActorURL(currentActor))
      )

      if (isMentioned) {
        const account = currentActor.account

        if (!status.isLocalActor) {
          try {
            await database.createNotification({
              actorId: currentActor.id,
              type: NotificationType.enum.mention,
              sourceActorId: status.actorId,
              statusId: status.id,
              groupKey: `mention:${status.id}`
            })
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Failed to create mention notification record'
            })
            span.recordException(
              error instanceof Error ? error : new Error(String(error))
            )
          }
        }

        if (config.email && account && status.actor) {
          try {
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
