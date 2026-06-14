import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/reblog'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { shouldCreateNotification } from '@/lib/services/notifications/shouldNotify'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getOriginalStatus } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { getTracer } from '@/lib/utils/trace'

interface UserAnnounceParams {
  currentActor: Actor
  statusId: string
  database: Database
  // Mastodon's reblog endpoint accepts an optional visibility for the boost.
  // Limited/direct are not valid for boosts, so only public/unlisted/private
  // are honored here; anything else falls back to the default public audience.
  visibility?: MastodonVisibility
}

// Derives the announce recipient lists from the requested visibility. The
// default (public) preserves the historical to/cc exactly so existing boosts
// are unaffected; unlisted moves Public into cc, and private keeps the boost
// to followers only.
const getAnnounceRecipients = (
  currentActor: Actor,
  visibility: MastodonVisibility | undefined
): { to: string[]; cc: string[] } => {
  switch (visibility) {
    case 'unlisted':
      return {
        to: [currentActor.followersUrl],
        cc: [ACTIVITY_STREAM_PUBLIC, currentActor.id]
      }
    case 'private':
      return {
        to: [currentActor.followersUrl],
        cc: [currentActor.id]
      }
    default:
      return {
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [currentActor.id, currentActor.followersUrl]
      }
  }
}

export const userAnnounce = async ({
  currentActor,
  statusId,
  database,
  visibility
}: UserAnnounceParams) =>
  getTracer().startActiveSpan('userAnnounce', async (span) => {
    const [originalStatus, actorAnnounceStatus] = await Promise.all([
      database.getStatus({
        statusId,
        withReplies: false
      }),
      database.getActorAnnounceStatus({ statusId, actorId: currentActor.id })
    ])

    if (!originalStatus || actorAnnounceStatus) {
      span.end()
      return null
    }

    const id = `${currentActor.id}/statuses/${crypto.randomUUID()}`
    const { to, cc } = getAnnounceRecipients(currentActor, visibility)
    const status = await database.createAnnounce({
      id,
      actorId: currentActor.id,
      to,
      cc,
      originalStatusId: originalStatus.id
    })
    if (!status) {
      span.end()
      return null
    }
    await addStatusToTimelines(database, status)

    // Create reblog notification if reblogging someone else's status
    if (
      await shouldCreateNotification(
        database,
        originalStatus.actorId,
        currentActor.id
      )
    ) {
      const reblogNotification = await createNotificationWithPolicy(database, {
        actorId: originalStatus.actorId,
        type: NotificationType.enum.reblog,
        sourceActorId: currentActor.id,
        statusId: originalStatus.id,
        groupKey: `reblog:${originalStatus.id}`
      })

      if (reblogNotification && !reblogNotification.filtered) {
        // Fire-and-forget: notification delivery must not fail the announce action
        database
          .getActorFromId({ id: originalStatus.actorId })
          .then((targetActor) => {
            const editableStatus = getOriginalStatus(originalStatus)
            sendNotificationAlerts({
              database,
              actorId: originalStatus.actorId,
              sourceActorId: currentActor.id,
              sourceActor: currentActor,
              statusId: originalStatus.id,
              events: [
                {
                  type: NotificationType.enum.reblog,
                  notificationId: reblogNotification.id,
                  emailContent: targetActor?.account
                    ? {
                        recipientEmail: targetActor.account.email,
                        subject: getSubject(currentActor),
                        text: getTextContent(currentActor, editableStatus),
                        html: getHTMLContent(currentActor, editableStatus)
                      }
                    : undefined
                }
              ]
            })
          })
          .catch(() => undefined)
      }
    }

    await getQueue().publish({
      id: getHashFromString(status.id),
      name: SEND_ANNOUNCE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId: status.id
      }
    })

    span.end()
    return status
  })
