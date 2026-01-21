import { AcceptFollow } from '@/lib/activities/actions/acceptFollow'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'
import { FollowStatus } from '@/lib/models/follow'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'

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
  const config = getConfig()
  const follow = await database.getFollowFromId({ followId })
  if (!follow) return null
  await database.updateFollowStatus({
    followId,
    status: FollowStatus.enum.Accepted
  })

  if (config.email) {
    const [actor, targetActor] = await Promise.all([
      database.getActorFromId({ id: follow.actorId }),
      database.getActorFromId({ id: follow.targetActorId })
    ])

    if (targetActor?.account && actor) {
      // Check if email notifications are enabled for this notification type
      const shouldSendEmail = await shouldSendEmailForNotification(
        database,
        targetActor.id,
        NotificationType.enum.follow
      )

      if (shouldSendEmail) {
        await sendMail({
          from: config.email.serviceFromAddress,
          to: [targetActor.account.email],
          subject: getSubject(actor),
          content: {
            text: getTextContent(actor),
            html: getHTMLContent(actor)
          }
        })
      }
    }
  }

  return follow
}
