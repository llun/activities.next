import { getBaseURL, getConfig } from '@/lib/config'
import {
  getShortName,
  toQuoteAuthor
} from '@/lib/services/email/layout/actorDisplay'
import {
  button,
  headline,
  paragraph,
  quote
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'

export interface FollowRequestEmailParams {
  /** The locked account being asked — receives this email. */
  recipient: ActorProfile
  /** The actor requesting to follow. */
  actor: ActorProfile
}

/** Someone asked to follow a manually-approved account. */
export const buildFollowRequestEmail = ({
  recipient,
  actor
}: FollowRequestEmailParams): RenderedEmail => {
  const author = toQuoteAuthor(actor)

  return renderEmail({
    subject: `@${actor.username} wants to follow you in ${getConfig().host}`,
    preheader: `${author.displayName} (${author.handle}) has requested to follow you.`,
    blocks: [
      headline(`${getShortName(actor)} wants to follow you`),
      paragraph(
        'Your account approves followers manually. Review this request to approve or reject it.'
      ),
      quote({ author }),
      // Notifications, not the profile: the approve/reject controls live there.
      button({
        label: 'Review request',
        url: `${getBaseURL()}/notifications`
      })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'follow requests',
      handle: getMention(recipient, true)
    }
  })
}
