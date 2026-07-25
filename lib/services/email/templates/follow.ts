import { getConfig } from '@/lib/config'
import {
  getShortName,
  toQuoteAuthor
} from '@/lib/services/email/layout/actorDisplay'
import { button, headline, quote } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'

import { getEmailActorUrl } from './statusUrl'

export interface FollowEmailParams {
  /** The actor being followed — receives this email. */
  recipient: ActorProfile
  /** The new follower. */
  actor: ActorProfile
}

/** Someone started following you, or you accepted their follow request. */
export const buildFollowEmail = ({
  recipient,
  actor
}: FollowEmailParams): RenderedEmail => {
  const author = toQuoteAuthor(actor)

  return renderEmail({
    subject: `@${actor.username} is following you in ${getConfig().host}`,
    preheader: `${author.displayName} (${author.handle}) is now following you.`,
    blocks: [
      headline(`${getShortName(actor)} is following you`),
      quote({ author }),
      // The LOCAL profile page, not actor.id. The previous template linked the
      // remote actor URI, which drops the reader on another server with no
      // session and no follow button.
      button({ label: 'View profile', url: getEmailActorUrl(author.handle) })
    ],
    footer: {
      kind: 'notification',
      eventLabel: 'new followers',
      handle: getMention(recipient, true)
    }
  })
}
