import { getConfig } from '@/lib/config'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

export const getSubject = (actor: ActorProfile) =>
  `@${actor.username} replied to your post in ${getConfig().host}`

const getLocalStatusUrl = (status: EditableStatus): string => {
  const config = getConfig()
  if (status.url.startsWith(`https://${config.host}`)) {
    return status.url
  }
  if (!status.actor) {
    return status.url
  }
  const actorMention = getMention(status.actor, true)
  const encodedStatusId = encodeURIComponent(status.id)
  return `https://${config.host}/${actorMention}/${encodedStatusId}`
}

export const getTextContent = (status: EditableStatus) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'

  return `
${actorMention} replied to your post.

Reply: ${status.text}

View this post on your server: ${localUrl}
`.trim()
}

export const getHTMLContent = (status: EditableStatus) => {
  const config = getConfig()
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'
  const messageHtml = status.isLocalActor
    ? convertMarkdownText(config.host)(status.text)
    : sanitizeText(status.text)

  return `
<h3>${actorMention} replied to your post</h3>
<p><strong>Reply:</strong></p>
<div>${messageHtml}</div>
<p><a href="${localUrl}">View this post on your server</a></p>
`.trim()
}
