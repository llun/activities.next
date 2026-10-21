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

export interface ReplyEmailParams {
  /** The actor replied to — receives this email. */
  recipient: ActorProfile
  /** Who replied. */
  actor: ActorProfile
  /** The reply itself, not the post it answers. */
  status: EditableStatus
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/** Someone replied to your post. The quote block shows their reply. */
export const buildReplyEmail = ({
  recipient,
  actor,
  status,
  brand
}: ReplyEmailParams): RenderedEmail =>
  renderEmail({
    brand,
    subject: `@${actor.username} replied to your post in ${brandHost(brand)}`,
    preheader: `${getShortName(actor)} replied to your post.`,
    blocks: [
      headline(`${getShortName(actor)} replied to your post`),
      label('Reply:'),
      quote({
        author: toQuoteAuthor(status.actor ?? actor),
        body: getStatusBody(status, brand)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status, brand) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'replies',
      handle: getMention(recipient, true)
    }
  })
