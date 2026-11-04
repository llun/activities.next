import { Span, SpanStatusCode } from '@opentelemetry/api'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { resolveActorEmailBrand } from '@/lib/services/email/sender'
import { buildMentionEmail } from '@/lib/services/email/templates/mention'
import { buildReplyEmail } from '@/lib/services/email/templates/reply'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import {
  NotificationEvent,
  sendNotificationAlerts
} from '@/lib/services/notifications/sendNotificationAlerts'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { NotificationType } from '@/lib/types/database/operations'
import { getActorURL } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { TagType } from '@/lib/types/domain/tag'
import { withSpan } from '@/lib/utils/trace'

import { TimelineRuleParams } from './types'

/**
 * Whether `actorId` already holds a `mention:<statusId>` notification for this
 * status, filtered or not. Both mention-notification paths check it so a
 * partial-failure retry (or a re-delivered Update) cannot double-notify.
 */
export const hasMentionNotification = async ({
  database,
  actorId,
  statusId
}: {
  database: Database
  actorId: string
  statusId: string
}): Promise<boolean> => {
  const existing = await database.getNotificationsForGroupKey({
    actorId,
    groupKey: `mention:${statusId}`,
    includeFiltered: true,
    limit: 1
  })
  return existing.some(
    (notification) =>
      notification.type === NotificationType.enum.mention &&
      notification.statusId === statusId
  )
}

const createRemoteMentionNotificationEvent = async ({
  database,
  currentActor,
  status,
  span
}: TimelineRuleParams & { span: Span }): Promise<NotificationEvent | null> => {
  if (status.type === StatusType.enum.Announce) return null
  const config = getConfig()
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

  if (!mentionNotification || mentionNotification.filtered) {
    return null
  }

  const mentionEvent: NotificationEvent = {
    type: NotificationType.enum.mention,
    notificationId: mentionNotification.id
  }
  if (config.email && account && status.actor) {
    mentionEvent.emailContent = {
      recipientEmail: account.email,
      ...buildMentionEmail({
        recipient: currentActor,
        brand: await resolveActorEmailBrand(database, currentActor),
        actor: status.actor,
        status
      })
    }
  }
  return mentionEvent
}

/**
 * Create a mention-only notification (with push and email alerts) for a local
 * actor newly mentioned in an inbound remote status edit. Never creates reply
 * notifications, and skips actors who already have a `mention:<statusId>`
 * notification for this status.
 */
export const notifyRemoteMention = async ({
  database,
  currentActor,
  status
}: TimelineRuleParams): Promise<void> =>
  withSpan(
    'timeline',
    'notifyRemoteMention',
    {
      actorId: currentActor.id,
      statusId: status.id
    },
    async (span) => {
      if (
        status.type === StatusType.enum.Announce ||
        status.isLocalActor ||
        status.actorId === currentActor.id
      ) {
        return
      }
      if (
        await database.isEitherBlocking({
          actorIdA: currentActor.id,
          actorIdB: status.actorId
        })
      ) {
        return
      }

      // A mention-only notification is for an actor who can read the status. An
      // Update can add a Mention tag for someone the status does not address,
      // and notifying them would leak that the post exists.
      if (!(await canActorReadStatus({ database, status, currentActor }))) {
        return
      }

      // A reply to the recipient's own post is already covered by the reply
      // notification, which `notifyRemoteReplyAndMention` suppresses the
      // mention for. An edit that adds the Mention tag must not create a
      // second entry for the same event.
      if (status.reply) {
        const repliedStatus = await database.getStatus({
          statusId: status.reply,
          withReplies: false
        })
        if (repliedStatus?.actorId === currentActor.id) return
      }

      if (
        await hasMentionNotification({
          database,
          actorId: currentActor.id,
          statusId: status.id
        })
      ) {
        return
      }

      const mentionEvent = await createRemoteMentionNotificationEvent({
        database,
        currentActor,
        status,
        span
      })
      if (mentionEvent) {
        sendNotificationAlerts({
          database,
          actorId: currentActor.id,
          sourceActorId: status.actorId,
          statusId: status.id,
          events: [mentionEvent]
        })
      }
    }
  )

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
  withSpan(
    'timeline',
    'notifyRemoteReplyAndMention',
    {
      actorId: currentActor.id,
      statusId: status.id
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
        return
      }
      if (
        await database.isEitherBlocking({
          actorIdA: currentActor.id,
          actorIdB: status.actorId
        })
      ) {
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
                  ...buildReplyEmail({
                    recipient: currentActor,
                    brand: await resolveActorEmailBrand(database, currentActor),
                    actor: status.actor,
                    status
                  })
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
        const mentionEvent = await createRemoteMentionNotificationEvent({
          database,
          currentActor,
          status,
          span
        })
        if (mentionEvent) {
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
    }
  )
