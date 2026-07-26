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
import { REPLY_SENTINEL } from '@/lib/services/email/replyMarker'
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
  /**
   * Set only when the message will carry a reply-by-email `Reply-To`.
   * Adds the marker line the inbound parser cuts on.
   */
  repliable?: boolean
}

/** Someone replied to your post. The quote block shows their reply. */
export const buildReplyEmail = ({
  recipient,
  actor,
  status,
  repliable = false
}: ReplyEmailParams): RenderedEmail =>
  renderEmail({
    ...(repliable ? { replyMarker: REPLY_SENTINEL } : null),
    subject: `@${actor.username} replied to your post in ${getConfig().host}`,
    preheader: `${getShortName(actor)} replied to your post.`,
    blocks: [
      headline(`${getShortName(actor)} replied to your post`),
      label('Reply:'),
      quote({
        author: toQuoteAuthor(status.actor ?? actor),
        body: getStatusBody(status)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'replies',
      handle: getMention(recipient, true)
    }
  })
