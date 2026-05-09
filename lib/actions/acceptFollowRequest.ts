import { AcceptFollow } from '@/lib/activities/acceptFollow'
import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

interface AcceptFollowRequestParams {
  activity: AcceptFollow
  database: Database
}

export const acceptFollowRequest = async ({
  activity,
  database
}: AcceptFollowRequestParams) => {
  const followRequestId = new URL(activity.object.id)
  const followId = followRequestId.pathname.slice(1)
  const follow = await database.getFollowFromId({ followId })
  if (!follow) return null
  if (
    await database.isEitherBlocking({
      actorIdA: follow.actorId,
      actorIdB: follow.targetActorId
    })
  ) {
    await database.updateFollowStatus({
      followId,
      status: FollowStatus.enum.Undo
    })

    getQueue()
      .publish({
        id: getHashFromString(`${follow.id}/undo`),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: {
          actorId: follow.actorId,
          follow
        }
      })
      .catch((error) => {
        logger.warn({
          message: 'Failed to queue Undo Follow federation',
          actorId: follow.actorId,
          targetActorId: follow.targetActorId,
          followId,
          error
        })
      })

    return follow
  }

  await database.updateFollowStatus({
    followId,
    status: FollowStatus.enum.Accepted
  })

  const [actor, targetActor] = await Promise.all([
    database.getActorFromId({ id: follow.actorId }),
    database.getActorFromId({ id: follow.targetActorId })
  ])

  if (actor && targetActor?.account) {
    sendNotificationAlerts({
      database,
      actorId: targetActor.id,
      sourceActorId: actor.id,
      sourceActor: actor,
      events: [
        {
          type: NotificationType.enum.follow,
          emailContent: {
            recipientEmail: targetActor.account.email,
            subject: getSubject(actor),
            text: getTextContent(actor),
            html: getHTMLContent(actor)
          }
        }
      ]
    })
  }

  return follow
}
