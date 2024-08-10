import { Note } from '../activities/entities/note'
import { getConfig } from '../config'
import { Attachment } from '../models/attachment'
import { StatusData, StatusType } from '../models/status'
import { Tag } from '../models/tag'
import { getISOTimeUTC } from './getISOTimeUTC'
import { convertMarkdownText } from './text/convertMarkdownText'

export const getNoteFromStatusData = (status: StatusData): Note | null => {
  if (status.type === StatusType.enum.Poll) return null

  const actualStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status

  return {
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
      new Attachment(attachment).toObject()
    ),
    tag: actualStatus.tags.map((tag) => new Tag(tag).toObject()),
    replies: {
      id: `${actualStatus.id}/replies`,
      type: 'Collection',
      totalItems: actualStatus.replies.length,
      items: actualStatus.replies.map((reply) =>
        getNoteFromStatusData(StatusData.parse(reply))
      )
    },
    ...(actualStatus.updatedAt
      ? { updated: getISOTimeUTC(actualStatus.updatedAt) }
      : null)
  } as Note
}
