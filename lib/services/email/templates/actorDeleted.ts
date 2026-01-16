import { getConfig } from '@/lib/config'
import { Actor } from '@/lib/models/actor'

export const getSubject = (actor: Actor) =>
  `Your actor @${actor.username}@${actor.domain} has been deleted from ${getConfig().host}`

export const getTextContent = (actor: Actor) =>
  `
Your actor @${actor.username}@${actor.domain} has been successfully deleted.

All data associated with this actor, including posts, follows, and media, has been permanently removed from ${getConfig().host}.

If you did not request this deletion, please contact us immediately.
`.trim()

export const getHTMLContent = (actor: Actor) =>
  `
<h2>Actor Deletion Complete</h2>
<p>Your actor <strong>@${actor.username}@${actor.domain}</strong> has been successfully deleted.</p>
<p>All data associated with this actor, including posts, follows, and media, has been permanently removed from ${getConfig().host}.</p>
<p>If you did not request this deletion, please contact us immediately.</p>
`.trim()
