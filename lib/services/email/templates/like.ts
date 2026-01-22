import { getConfig } from '@/lib/config'
import { ActorProfile, getMention } from '@/lib/models/actor'
import { EditableStatus } from '@/lib/models/status'

export const getSubject = (actor: ActorProfile) =>
  `@${actor.username} liked your post in ${getConfig().host}`

const getLocalStatusUrl = (status: EditableStatus): string => {
  if (!status.actor) {
    return status.url
  }
  const config = getConfig()
  const actorMention = getMention(status.actor, true)
  const encodedStatusId = encodeURIComponent(status.id)
  return `https://${config.host}/${actorMention}/${encodedStatusId}`
}

export const getTextContent = (actor: ActorProfile, status: EditableStatus) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = getMention(actor, true)

  return `
${actorMention} liked your post.

Your post: ${status.text}

View this post on your server: ${localUrl}
`.trim()
}

export const getHTMLContent = (actor: ActorProfile, status: EditableStatus) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = getMention(actor, true)

  return `
<h3>${actorMention} liked your post</h3>
<p><strong>Your post:</strong></p>
<p>${status.text}</p>
<p><a href="${localUrl}">View this post on your server</a></p>
`.trim()
}
