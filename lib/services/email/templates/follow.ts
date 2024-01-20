import { getConfig } from '@/lib/config'
import { Actor } from '@/lib/models/actor'

export const getSubject = (actor: Actor) =>
  `@${actor.username} is following you in ${getConfig().host}`

export const getTextContent = (actor: Actor) =>
  `
${actor.username} (${actor.id}) is following you
`.trim()

export const getHTMLContent = (actor: Actor) =>
  `
<p><a href="${actor.id}">${actor.username}</a> is following you</p>
`.trim()
