import { ActorProfile } from '@/lib/types/domain/actor'

/**
 * The `@username@domain` segment of a status detail path, with each part
 * percent-encoded. A remote username is whatever the peer's
 * `preferredUsername` said, so a raw `/`, `?`, `#` or `..` in it would turn
 * `/@user@domain/<id>` into a different same-origin path (the link in a
 * notification email, for one). Ordinary usernames encode to themselves.
 */
export const getActorMentionPathSegment = (
  actor: Pick<ActorProfile, 'username' | 'domain'>
) =>
  `@${encodeURIComponent(actor.username)}@${encodeURIComponent(actor.domain)}`
