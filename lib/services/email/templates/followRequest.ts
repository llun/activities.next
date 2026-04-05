import { getConfig } from '@/lib/config'
import { Actor } from '@/lib/types/domain/actor'

export const getSubject = (actor: Actor) =>
  `@${actor.username} wants to follow you in ${getConfig().host}`

export const getTextContent = (actor: Actor) =>
  `
${actor.username} (${actor.id}) has requested to follow you
`.trim()

export const getHTMLContent = (actor: Actor) =>
  `
<p><a href="${actor.id}">${actor.username}</a> has requested to follow you</p>
`.trim()
