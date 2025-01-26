import { AcceptFollow } from '@/lib/activities/actions/acceptFollow'
import { getConfig } from '@/lib/config'
import { Storage } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'

interface AcceptFollowRequestParams {
  activity: AcceptFollow
  storage: Storage
}

export const acceptFollowRequest = async ({
  activity,
  storage
}: AcceptFollowRequestParams) => {
  const followRequestId = new URL(activity.object.id)
  const followId = followRequestId.pathname.slice(1)
  const config = getConfig()
  const follow = await storage.getFollowFromId({ followId })
  if (!follow) return null
  await storage.updateFollowStatus({
    followId,
    status: FollowStatus.enum.Accepted
  })

  if (config.email) {
    const [actor, targetActor] = await Promise.all([
      storage.getActorFromId({ id: follow.actorId }),
      storage.getActorFromId({ id: follow.targetActorId })
    ])

    if (targetActor?.account && actor) {
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

  return follow
}
