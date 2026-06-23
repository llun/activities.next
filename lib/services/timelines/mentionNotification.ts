import { SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import {
  getHTMLContent as getMentionHTMLContent,
  getSubject as getMentionSubject,
  getTextContent as getMentionTextContent
} from '@/lib/services/email/templates/mention'
import {
  getHTMLContent as getReplyHTMLContent,
  getSubject as getReplySubject,
  getTextContent as getReplyTextContent
} from '@/lib/services/email/templates/reply'
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

import { TimelineRuleParams } from './types'

/**
 * Create reply/mention notifications for an inbound REMOTE status.
 *
 * This was formerly `mentionTimelineRule`, which materialized a "mention"
 * timeline AND created reply/mention notifications. The mention timeline (and
 * its UI tab) has been removed, but this is still the only place that creates
 * reply and mention notifications for remote statuses — the local-actor path
 * lives in `createNote.ts`. It runs purely for its notification side effects
 * and no longer returns or materializes any timeline.
 *
 * Local-authored statuses are skipped early: their notifications are handled in
 * `createNote.ts`, and every notification branch below already requires
 * `!status.isLocalActor`.
 */
export const notifyRemoteReplyAndMention = async ({
  database,
  currentActor,
  status
}: TimelineRuleParams): Promise<void> =>
  getTracer().startActiveSpan(
    'timelines.notifyRemoteReplyAndMention',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id
      }
    },
    async (span) => {
      const config = getConfig()
      // Announces, self-authored statuses, and local-authored statuses never
      // generate a notification through this path.
      if (
        status.type === StatusType.enum.Announce ||
        status.isLocalActor ||
        status.actorId === currentActor.id
      ) {
        span.end()
        return
      }
      if (
        await database.isEitherBlocking({
          actorIdA: currentActor.id,
          actorIdB: status.actorId
        })
      ) {
        span.end()
        return
      }

      const alertEvents: NotificationEvent[] = []
      // A reply that also mentions the recipient is a single event. Once a reply
      // notification is created for this status we suppress the duplicate mention
      // notification below so the recipient sees one entry, not two.
      let replyNotificationCreated = false

      // --- Reply detection ---
      if (status.reply) {
        try {
          const repliedStatus = await database.getStatus({
            statusId: status.reply,
            withReplies: false
          })
          if (repliedStatus && repliedStatus.actorId === currentActor.id) {
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
            // Mark the reply handled as soon as we know it's a reply to the
            // current actor — before inspecting the policy verdict — so the
            // mention branch below is suppressed even when the reply
            // notification is dropped or filtered by policy. This matches the
            // local path in createNote.ts (which suppresses unconditionally) and
            // avoids a redundant mention policy evaluation. The notification
            // policy returns the same verdict for `reply` and `mention`, so no
            // duplicate can slip through; this just keeps the two paths aligned.
            replyNotificationCreated = true
            if (replyNotification && !replyNotification.filtered) {
              const replyEvent: NotificationEvent = {
                type: NotificationType.enum.reply,
                notificationId: replyNotification.id
              }
              // Carry the reply email on the surviving reply event. The mention
              // branch below — which used to attach the email for a
              // reply-that-mentions — is now skipped, so without this the email
              // channel would silently drop for that case.
              const account = currentActor.account
              if (config.email && account && status.actor) {
                replyEvent.emailContent = {
                  recipientEmail: account.email,
                  subject: getReplySubject(status.actor),
                  text: getReplyTextContent(status),
                  html: getReplyHTMLContent(status)
                }
              }
              alertEvents.push(replyEvent)
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

      // Skip the mention notification when a reply notification already covers
      // this status for the same recipient — they are the same event.
      if (isMentioned && !replyNotificationCreated) {
        const account = currentActor.account
        // Error is recorded but not re-thrown: a notification DB failure should
        // not block the rest of the alert dispatch.
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
            type: NotificationType.enum.mention,
            notificationId: mentionNotification.id
          }
          if (config.email && account && status.actor) {
            mentionEvent.emailContent = {
              recipientEmail: account.email,
              subject: getMentionSubject(status.actor),
              text: getMentionTextContent(status),
              html: getMentionHTMLContent(status)
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
    }
  )
