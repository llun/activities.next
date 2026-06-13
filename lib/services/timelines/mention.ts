import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
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
      if (
        await database.isEitherBlocking({
          actorIdA: currentActor.id,
          actorIdB: status.actorId
        })
      ) {
        span.end()
        return null
      }

      let addToTimeline = false
      const alertEvents: NotificationEvent[] = []
      // A reply that also mentions the recipient is a single event. Once a reply
      // notification is created for this status we suppress the duplicate mention
      // notification below so the recipient sees one entry, not two.
      let replyNotificationCreated = false

      // --- Reply detection ---
      if (status.reply && !status.isLocalActor) {
        try {
          const repliedStatus = await database.getStatus({
            statusId: status.reply,
            withReplies: false
          })
          if (repliedStatus && repliedStatus.actorId === currentActor.id) {
            addToTimeline = true
            const replyNotification = await createNotificationWithPolicy(
              database,
              {
                actorId: currentActor.id,
                type: NotificationType.enum.reply,
                sourceActorId: status.actorId,
                statusId: status.id,
                groupKey: `reply:${repliedStatus.id}`
              }
            )
            if (replyNotification) {
              replyNotificationCreated = true
              if (!replyNotification.filtered) {
                alertEvents.push({ type: NotificationType.enum.reply })
              }
            }
          }
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Failed to handle reply notification'
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

        // Skip the mention notification when a reply notification already covers
        // this status for the same recipient — they are the same event.
        if (!status.isLocalActor && !replyNotificationCreated) {
          // Error is recorded but not re-thrown: a notification DB failure
          // should not block the mention from being added to the timeline.
          let mentionNotification = null
          try {
            mentionNotification = await createNotificationWithPolicy(database, {
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

          if (mentionNotification && !mentionNotification.filtered) {
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
