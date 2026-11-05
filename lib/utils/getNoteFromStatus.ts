import { getLanguageMapFields } from '@/lib/activities/languageMapFields'
import { getPollQuestion } from '@/lib/activities/pollQuestion'
import {
  getInteractionPolicyFields,
  getQuoteNoteFields
} from '@/lib/activities/quoteNoteFields'
import { Note, Question } from '@/lib/types/activitypub'
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

import { getStatusWireContent } from './getStatusWireContent'

interface GetNoteFromStatusOptions {
  includeUpdated?: boolean
  // FEP-1b12 community actor id the note belongs to
  audience?: string | null
}

export const getNoteFromStatus = (
  status: Status,
  options: GetNoteFromStatusOptions = {}
): Note | Question | null => {
  const actualStatus = getOriginalStatus(status)
  const includeUpdated = options.includeUpdated ?? hasStatusBeenEdited(status)
  if (actualStatus.type === StatusType.enum.Poll) {
    return getPollQuestion(actualStatus, {
      ...options,
      includeUpdated,
      content: getStatusWireContent(actualStatus),
      replies: actualStatus.replies.map((reply) =>
        getNoteFromStatus(Status.parse(reply))
      )
    })
  }

  // Quote emission (FEP-044f), shared with the AP GET/outbox/replies surfaces so
  // a delivered note and a fetched one describe the same quote. Always advertise
  // who may quote THIS status via interactionPolicy.
  const quoteFields = getQuoteNoteFields(actualStatus.quote)
  const content = getStatusWireContent(actualStatus)

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
    ...(options.audience ? { audience: options.audience } : null),
    content,
    ...getLanguageMapFields(actualStatus, content),
    // Every non-fitness attachment federates, in stored order, as Pixelfed
    // does. Every write path bounds the list: MAX_STORED_MEDIA_ATTACHMENTS,
    // with a fitness file's generated route map counted inside it (the status
    // create and edit routes keep its slot free), or a lower import cap.
    // Mastodon keeps the first 4 of a remote post itself, so cutting here gains
    // nothing there and only loses photos on servers that show them all.
    attachment: actualStatus.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .map((attachment) => getDocumentFromAttachment(attachment)),
    tag: actualStatus.tags
      .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
      .filter((tag) => tag !== null),
    // Always a boolean, as Mastodon sends it: a receiver shows media marked
    // sensitive unblurred without it, and an edit that drops the key would
    // never un-mark a post on a receiver that keeps the stored flag.
    sensitive: Boolean(actualStatus.sensitive),
    replies: {
      id: `${actualStatus.id}/replies`,
      type: 'Collection',
      totalItems: actualStatus.replies.length,
      items: actualStatus.replies.map((reply) =>
        getNoteFromStatus(Status.parse(reply))
      )
    },
    ...quoteFields,
    ...getInteractionPolicyFields(actualStatus),
    ...(includeUpdated
      ? { updated: getISOTimeUTC(actualStatus.updatedAt) }
      : null)
  })
}
