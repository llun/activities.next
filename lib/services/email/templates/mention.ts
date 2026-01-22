import { getConfig } from '@/lib/config'
import { ActorProfile, getMention } from '@/lib/models/actor'
import { EditableStatus } from '@/lib/models/status'

export const getSubject = (actor: ActorProfile) =>
  `@${actor.username} mentions you in ${getConfig().host}`

const getLocalStatusUrl = (status: EditableStatus): string => {
  if (!status.actor) {
    return status.url
  }
  const config = getConfig()
  const actorMention = getMention(status.actor, true)
  const encodedStatusId = encodeURIComponent(status.id)
  return `https://${config.host}/${actorMention}/${encodedStatusId}`
}

export const getTextContent = (status: EditableStatus) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'

  return `
${actorMention} mentioned you in a post.

Message: ${status.text}

View this post on your server: ${localUrl}
`.trim()
}

export const getHTMLContent = (status: EditableStatus) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'

  return `
<h3>${actorMention} mentioned you in a post</h3>
<p><strong>Message:</strong></p>
<p>${status.text}</p>
<p><a href="${localUrl}">View this post on your server</a></p>
`.trim()
}
