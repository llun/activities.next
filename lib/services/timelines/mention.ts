import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import {
  NotificationEvent,
  sendNotificationAlerts
} from '@/lib/services/notifications/sendNotificationAlerts'
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

      let addToTimeline = false
      const alertEvents: NotificationEvent[] = []

      // --- Reply detection ---
      if (status.reply && !status.isLocalActor) {
        try {
          const repliedStatus = await database.getStatus({
            statusId: status.reply,
            withReplies: false
          })
          if (repliedStatus && repliedStatus.actorId === currentActor.id) {
            addToTimeline = true
            await database.createNotification({
              actorId: currentActor.id,
              type: NotificationType.enum.reply,
              sourceActorId: status.actorId,
              statusId: status.id,
              groupKey: `reply:${status.id}`
            })
            alertEvents.push({ type: NotificationType.enum.reply })
          }
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Failed to create reply notification record'
          })
          span.recordException(
            error instanceof Error ? error : new Error(String(error))
          )
        }
      }

      // --- Mention detection ---
      const mentionTags = await database.getTags({ statusId: status.id })
      const isMentioned = mentionTags.some(
        (tag) =>
          tag.type === TagType.enum.mention &&
          (tag.value === currentActor.id ||
            tag.value === getActorURL(currentActor))
      )

      if (isMentioned) {
        addToTimeline = true
        const account = currentActor.account

        if (!status.isLocalActor) {
          // Error is recorded but not re-thrown: a notification DB failure
          // should not block the mention from being added to the timeline.
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

          const mentionEvent: NotificationEvent = {
            type: NotificationType.enum.mention
          }
          if (config.email && account && status.actor) {
            mentionEvent.emailContent = {
              recipientEmail: account.email,
              subject: getSubject(status.actor),
              text: getTextContent(status),
              html: getHTMLContent(status)
            }
          }
          alertEvents.push(mentionEvent)
        }
      }

      // --- Dispatch all notification channels (push, email, …) ---
      if (alertEvents.length > 0) {
        sendNotificationAlerts({
          database,
          actorId: currentActor.id,
          sourceActorId: status.actorId,
          statusId: status.id,
          events: alertEvents
        })
      }

      span.end()
      return addToTimeline ? Timeline.MENTION : null
    }
  )
