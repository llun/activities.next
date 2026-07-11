import { getConfig } from '@/lib/config'
import { MAX_FEDERATION_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
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
import { getEmojiFromTag, getMentionFromTag } from '@/lib/types/domain/tag'
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
    // A status may store more media than Mastodon renders; only the first
    // MAX_FEDERATION_MEDIA_ATTACHMENTS federate so remote servers receive a
    // Mastodon-compatible payload. The extras stay visible on local surfaces.
    attachment: actualStatus.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .slice(0, MAX_FEDERATION_MEDIA_ATTACHMENTS)
      .map((attachment) => getDocumentFromAttachment(attachment)),
    tag: actualStatus.tags
      .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
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
