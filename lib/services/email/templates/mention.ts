import { getConfig } from '@/lib/config'
import {
  getShortName,
  toQuoteAuthor
} from '@/lib/services/email/layout/actorDisplay'
import { button, headline, quote } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'

import { getStatusBody } from './statusBody'
import { getEmailStatusUrl } from './statusUrl'

export interface MentionEmailParams {
  /** The mentioned actor — receives this email. */
  recipient: ActorProfile
  /** Who wrote the post. */
  actor: ActorProfile
  status: EditableStatus
}

/** Someone mentioned you. The quote block shows THEIR post, not yours. */
export const buildMentionEmail = ({
  recipient,
  actor,
  status
}: MentionEmailParams): RenderedEmail =>
  renderEmail({
    subject: `@${actor.username} mentions you in ${getConfig().host}`,
    preheader: `${getShortName(actor)} mentioned you in a post.`,
    blocks: [
      headline(`${getShortName(actor)} mentioned you in a post`),
      quote({
        author: toQuoteAuthor(status.actor ?? actor),
        body: getStatusBody(status)
      }),
      button({ label: 'View post', url: getEmailStatusUrl(status) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'mentions',
      handle: getMention(recipient, true)
    }
  })
