import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/reblog'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getTracer } from '@/lib/utils/trace'

interface UserAnnounceParams {
  currentActor: Actor
  statusId: string
  database: Database
}

export const userAnnounce = async ({
  currentActor,
  statusId,
  database
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
    const status = await database.createAnnounce({
      id,
      actorId: currentActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [currentActor.id, currentActor.followersUrl],
      originalStatusId: originalStatus.id
    })
    if (!status) {
      span.end()
      return null
    }
    await addStatusToTimelines(database, status)

    // Create reblog notification if reblogging someone else's status
    if (originalStatus.actorId !== currentActor.id) {
      await database.createNotification({
        actorId: originalStatus.actorId,
        type: NotificationType.enum.reblog,
        sourceActorId: currentActor.id,
        statusId: originalStatus.id,
        groupKey: `reblog:${originalStatus.id}`
      })

      // Send email notification (best-effort, don't fail reblog if email fails)
      const config = getConfig()
      if (config.email) {
        try {
          // Check if email notifications are enabled for this notification type
          const shouldSendEmail = await shouldSendEmailForNotification(
            database,
            originalStatus.actorId,
            NotificationType.enum.reblog
          )

          if (shouldSendEmail) {
            const targetActor = await database.getActorFromId({
              id: originalStatus.actorId
            })

            if (targetActor?.account) {
              // Extract editable status (handle Announce type)
              const editableStatus =
                originalStatus.type === 'Announce'
                  ? originalStatus.originalStatus
                  : originalStatus

              await sendMail({
                from: config.email.serviceFromAddress,
                to: [targetActor.account.email],
                subject: getSubject(currentActor),
                content: {
                  text: getTextContent(currentActor, editableStatus),
                  html: getHTMLContent(currentActor, editableStatus)
                }
              })
            }
          }
        } catch (error) {
          // Log error but don't fail the reblog operation
          console.error('Failed to send reblog notification email:', error)
        }
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
