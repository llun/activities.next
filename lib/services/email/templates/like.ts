import { getConfig } from '@/lib/config'
import {
  getShortName,
  toQuoteAuthor
} from '@/lib/services/email/layout/actorDisplay'
import {
  button,
  headline,
  label,
  quote
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'

import { getStatusBody } from './statusBody'
import { getEmailStatusUrl } from './statusUrl'

export interface LikeEmailParams {
  /** The post's author — receives this email. */
  recipient: ActorProfile
  /** Who liked it. */
  actor: ActorProfile
  status: EditableStatus
}

/** Someone liked your post. The quote block shows the recipient's own post. */
export const buildLikeEmail = ({
  recipient,
  actor,
  status
}: LikeEmailParams): RenderedEmail =>
  renderEmail({
    subject: `@${actor.username} liked your post in ${getConfig().host}`,
    preheader: `${getShortName(actor)} liked your post.`,
    blocks: [
      headline(`${getShortName(actor)} liked your post`),
      label('Your post:'),
      quote({
        // The recipient wrote the post being liked, so quote them — falling
        // back to the recipient when the status carries no actor.
        author: toQuoteAuthor(status.actor ?? recipient),
        body: getStatusBody(status)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'likes',
      handle: getMention(recipient, true)
    }
  })
