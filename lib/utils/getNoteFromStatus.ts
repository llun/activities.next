import { Note } from '@llun/activities.schema'

import { getConfig } from '@/lib/config'
import { getDocumentFromAttachment } from '@/lib/models/attachment'
import { Status, StatusType } from '@/lib/models/status'
import { getMentionFromTag } from '@/lib/models/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

export const getNoteFromStatus = (status: Status): Note | null => {
  if (status.type === StatusType.enum.Poll) return null

  const actualStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  return Note.parse({
    id: actualStatus.id,
    type: actualStatus.type,
    ...(actualStatus.summary ? { summary: actualStatus.summary } : null),
    published: getISOTimeUTC(actualStatus.createdAt),
    url: actualStatus.url,
    attributedTo: actualStatus.actorId,
    to: actualStatus.to,
    cc: actualStatus.cc,
    inReplyTo: actualStatus.reply || null,
    content: convertMarkdownText(getConfig().host)(actualStatus.text),
    attachment: actualStatus.attachments.map((attachment) =>
      getDocumentFromAttachment(attachment)
    ),
    tag: actualStatus.tags.map((tag) => getMentionFromTag(tag)),
    replies: {
      id: `${actualStatus.id}/replies`,
      type: 'Collection',
      totalItems: actualStatus.replies.length,
      items: actualStatus.replies.map((reply) =>
        getNoteFromStatus(Status.parse(reply))
      )
    },
    ...(actualStatus.updatedAt
      ? { updated: getISOTimeUTC(actualStatus.updatedAt) }
      : null)
  })
}
