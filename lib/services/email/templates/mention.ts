import { getConfig } from '@/lib/config'
import { REPLY_SENTINEL } from '@/lib/services/email/replyMarker'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { EditableStatus } from '@/lib/types/domain/status'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

// `repliable` is set when the message carries a reply-by-email Reply-To. It
// adds the sentinel line the inbound parser cuts on, so it must never be set
// for a message without that header — the line would promise something the
// instance cannot deliver.
export interface MentionTemplateOptions {
  repliable?: boolean
}

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

export const getTextContent = (
  status: EditableStatus,
  { repliable = false }: MentionTemplateOptions = {}
) => {
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'

  const body = `
${actorMention} mentioned you in a post.

Message: ${status.text}

View this post on your server: ${localUrl}
`.trim()

  return repliable ? `${REPLY_SENTINEL}\n\n${body}` : body
}

export const getHTMLContent = (
  status: EditableStatus,
  { repliable = false }: MentionTemplateOptions = {}
) => {
  const config = getConfig()
  const localUrl = getLocalStatusUrl(status)
  const actorMention = status.actor ? getMention(status.actor, true) : 'Unknown'
  const messageHtml = status.isLocalActor
    ? convertMarkdownText(config.host)(status.text)
    : sanitizeText(status.text)

  const body = `
<h3>${actorMention} mentioned you in a post</h3>
<p><strong>Message:</strong></p>
<div>${messageHtml}</div>
<p><a href="${localUrl}">View this post on your server</a></p>
`.trim()

  return repliable ? `<p>${REPLY_SENTINEL}</p>\n${body}` : body
}
