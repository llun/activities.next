import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/reblog'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
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

      const targetActor = await database.getActorFromId({
        id: originalStatus.actorId
      })

      const editableStatus =
        originalStatus.type === 'Announce'
          ? originalStatus.originalStatus
          : originalStatus

      sendNotificationAlerts({
        database,
        actorId: originalStatus.actorId,
        sourceActorId: currentActor.id,
        sourceActor: currentActor,
        statusId: originalStatus.id,
        events: [
          {
            type: NotificationType.enum.reblog,
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
