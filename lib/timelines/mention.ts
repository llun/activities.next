import { getConfig } from '../config'
import { StatusType } from '../models/status'
import { sendMail } from '../services/email'
import { getSpan } from '../trace'
import { MentionTimelineRule, Timeline } from './types'

export const mentionTimelineRule: MentionTimelineRule = async ({
  currentActor,
  status
}) => {
  const span = getSpan('timelines', 'mentionTimelineRule', {
    actorId: currentActor.id,
    statusId: status.id
  })
  const config = getConfig()
  if (status.type === StatusType.Announce) {
    span?.finish()
    return null
  }

  if (status.actorId === currentActor.id) {
    span?.finish()
    return Timeline.MENTION
  }

  if (status.text.includes(currentActor.getActorPage())) {
    const account = currentActor.account
    if (config.email && account) {
      await sendMail({
        from: config.email.serviceFromAddress,
        to: [account.email],
        subject: `@${status.actor?.username} mentions you in ${config.host}`,
        content: {
          text: `Message: ${status.text}`.trim(),
          html: status.text
        }
      })
    }
    span?.finish()
    return Timeline.MENTION
  }

  span?.finish()
  return null
}
