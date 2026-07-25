import { getConfig } from '@/lib/config'
import { REPLY_SENTINEL } from '@/lib/services/email/replyMarker'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

// See MentionTemplateOptions: only set `repliable` when the message actually
// carries a reply-by-email Reply-To header.
export interface ReplyTemplateOptions {
  repliable?: boolean
}

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

export const getTextContent = (
  status: EditableStatus,
  { repliable = false }: ReplyTemplateOptions = {}
) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'

  const body = `
${actorMention} replied to your post.

Reply: ${status.text}

View this post on your server: ${localUrl}
`.trim()

  return repliable ? `${REPLY_SENTINEL}\n\n${body}` : body
}

export const getHTMLContent = (
  status: EditableStatus,
  { repliable = false }: ReplyTemplateOptions = {}
) => {
  const config = getConfig()
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'
  const messageHtml = status.isLocalActor
    ? convertMarkdownText(config.host)(status.text)
    : sanitizeText(status.text)

  const body = `
<h3>${actorMention} replied to your post</h3>
<p><strong>Reply:</strong></p>
<div>${messageHtml}</div>
<p><a href="${localUrl}">View this post on your server</a></p>
`.trim()

  return repliable ? `<p>${REPLY_SENTINEL}</p>\n${body}` : body
}
