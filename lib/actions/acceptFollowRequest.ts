import { AcceptFollow } from '@/lib/activities/acceptFollow'
import { Database } from '@/lib/database/types'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'

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
