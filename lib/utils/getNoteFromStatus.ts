import { getConfig } from '@/lib/config'
import { Note } from '@/lib/types/activitypub'
import {
  getDocumentFromAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
import {
  Status,
  StatusType,
  getOriginalStatus,
  hasStatusBeenEdited
} from '@/lib/types/domain/status'
import { getMentionFromTag } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

interface GetNoteFromStatusOptions {
  includeUpdated?: boolean
}

export const getNoteFromStatus = (
  status: Status,
  options: GetNoteFromStatusOptions = {}
): Note | null => {
  const actualStatus = getOriginalStatus(status)
  if (actualStatus.type === StatusType.enum.Poll) return null
  const includeUpdated = options.includeUpdated ?? hasStatusBeenEdited(status)

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
    attachment: actualStatus.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .map((attachment) => getDocumentFromAttachment(attachment)),
    tag: actualStatus.tags
      .filter((tag) => tag.type !== 'emoji')
      .map((tag) => getMentionFromTag(tag))
      .filter((tag) => tag !== null),
    replies: {
      id: `${actualStatus.id}/replies`,
      type: 'Collection',
      totalItems: actualStatus.replies.length,
      items: actualStatus.replies.map((reply) =>
        getNoteFromStatus(Status.parse(reply))
      )
    },
    ...(includeUpdated
      ? { updated: getISOTimeUTC(actualStatus.updatedAt) }
      : null)
  })
}
