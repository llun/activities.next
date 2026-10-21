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

export interface BoostEmailParams {
  /** The post's author — receives this email. */
  recipient: ActorProfile
  /** Who boosted it. */
  actor: ActorProfile
  status: EditableStatus
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

/**
 * Someone boosted your post. The quote block shows the recipient's own post.
 *
 * User-facing copy says "boosted"; the internal vocabulary stays "reblog" —
 * `NotificationType.reblog`, the stored value, and the Mastodon API field are
 * the fediverse wire term and must not move. That is also why this file keeps
 * its name: it preserves the 1:1 mapping between module and notification type
 * that the other templates have.
 */
export const buildBoostEmail = ({
  recipient,
  actor,
  status,
  brand
}: BoostEmailParams): RenderedEmail =>
  renderEmail({
    brand,
    subject: `@${actor.username} boosted your post in ${brandHost(brand)}`,
    preheader: `${getShortName(actor)} boosted your post.`,
    blocks: [
      headline(`${getShortName(actor)} boosted your post`),
      label('Your post:'),
      quote({
        // The recipient wrote the post being boosted, so quote them — falling
        // back to the recipient when the status carries no actor.
        author: toQuoteAuthor(status.actor ?? recipient),
        body: getStatusBody(status, brand)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status, brand) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'boosts',
      handle: getMention(recipient, true)
    }
  })
