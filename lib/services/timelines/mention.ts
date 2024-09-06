import { getConfig } from '@/lib/config'
import { StatusType } from '@/lib/models/status'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/mention'
import { getTracer } from '@/lib/utils/trace'

import { MentionTimelineRule, Timeline } from './types'

export const mentionTimelineRule: MentionTimelineRule = async ({
  currentActor,
  status
}) =>
  getTracer().startActiveSpan(
    'timelines.mentionTimelineRule',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id
      }
    },
    async (span) => {
      const config = getConfig()
      if (status.type === StatusType.enum.Announce) {
        span.end()
        return null
      }

      if (status.actorId === currentActor.id) {
        span.end()
        return Timeline.MENTION
      }

      if (status.text.includes(currentActor.getActorPage())) {
        const account = currentActor.account
        if (config.email && account && status.actor) {
          await sendMail({
            from: config.email.serviceFromAddress,
            to: [account.email],
            subject: getSubject(status.actor),
            content: {
              text: getTextContent(status),
              html: getHTMLContent(status)
            }
          })
        }
        span.end()
        return Timeline.MENTION
      }

      span.end()
      return null
    }
  )
