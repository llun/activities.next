import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { sendPushNotification } from '@/lib/services/notifications/pushNotification'
import { NotificationType } from '@/lib/types/database/operations'
import { getActorURL } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { TagType } from '@/lib/types/domain/tag'
import { logger } from '@/lib/utils/logger'
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
      let pushSent = false

      // Check if this is a reply to current actor's post from a remote actor
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

            // Fire-and-forget push notification for reply
            pushSent = true
            database
              .getActorFromId({ id: status.actorId })
              .then((sourceActor) => {
                if (!sourceActor) return
                return sendPushNotification({
                  database,
                  actorId: currentActor.id,
                  type: NotificationType.enum.reply,
                  sourceActor,
                  statusId: status.id
                })
              })
              .catch((error) =>
                logger.error({
                  message: 'Failed to send reply push notification',
                  err: error
                })
              )
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

          // Fire-and-forget push notification for mention.
          // Skip if reply push was already sent to avoid duplicate browser
          // notifications for the same status.
          if (!pushSent) {
            database
              .getActorFromId({ id: status.actorId })
              .then((sourceActor) => {
                if (!sourceActor) return
                return sendPushNotification({
                  database,
                  actorId: currentActor.id,
                  type: NotificationType.enum.mention,
                  sourceActor,
                  statusId: status.id
                })
              })
              .catch((error) =>
                logger.error({
                  message: 'Failed to send mention push notification',
                  err: error
                })
              )
          }
        }

        if (config.email && account && status.actor) {
          // Error is recorded but not re-thrown: email delivery failure is
          // best-effort and should not affect the notification DB write above.
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
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Failed to send mention notification email'
            })
            span.recordException(
              error instanceof Error ? error : new Error(String(error))
            )
          }
        }
      }

      span.end()
      return addToTimeline ? Timeline.MENTION : null
    }
  )
