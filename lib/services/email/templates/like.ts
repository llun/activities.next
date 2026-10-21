import { type EmailBrand, brandHost } from '@/lib/services/email/brand'
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
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/** Someone liked your post. The quote block shows the recipient's own post. */
export const buildLikeEmail = ({
  recipient,
  actor,
  status,
  brand
}: LikeEmailParams): RenderedEmail =>
  renderEmail({
    brand,
    subject: `@${actor.username} liked your post in ${brandHost(brand)}`,
    preheader: `${getShortName(actor)} liked your post.`,
    blocks: [
      headline(`${getShortName(actor)} liked your post`),
      label('Your post:'),
      quote({
        // The recipient wrote the post being liked, so quote them — falling
        // back to the recipient when the status carries no actor.
        author: toQuoteAuthor(status.actor ?? recipient),
        body: getStatusBody(status, brand)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status, brand) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'likes',
      handle: getMention(recipient, true)
    }
  })
