import { getLanguageMapFields } from '@/lib/activities/languageMapFields'
import { getPollQuestion } from '@/lib/activities/pollQuestion'
import {
  getInteractionPolicyFields,
  getQuoteNoteFields
} from '@/lib/activities/quoteNoteFields'
import { Note, Question } from '@/lib/types/activitypub/objects'
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

export const toActivityPubObject = (status: Status): Note | Question => {
  const originalStatus = getOriginalStatus(status)
  if (originalStatus.type === StatusType.enum.Poll) {
    return getPollQuestion(originalStatus, {
      content: getStatusWireContent(originalStatus),
      includeUpdated: hasStatusBeenEdited(originalStatus),
      replies: originalStatus.replies.map((reply) =>
        toActivityPubObject(Status.parse(reply))
      )
    })
  }

  // Quote emission (FEP-044f), shared with `getNoteFromStatus` so a note a peer
  // FETCHES (this route, the outbox, the replies collection) describes its quote
  // exactly as one delivered to their inbox does. Every surface returning this
  // object must declare QUOTE_ACTIVITY_CONTEXT or a receiver that compacts the
  // document drops these terms.
  const quoteFields = getQuoteNoteFields(originalStatus.quote)
  const content = getStatusWireContent(originalStatus)
  return Note.parse({
    id: originalStatus.id,
    type: originalStatus.type,
    summary: originalStatus.summary || null,
    url: originalStatus.url,
    attributedTo: originalStatus.actorId,
    to: originalStatus.to,
    cc: originalStatus.cc,
    inReplyTo: originalStatus.reply || null,
    content,
    ...getLanguageMapFields(originalStatus, content),
    // Every non-fitness attachment, in stored order (outbox and the AP
    // note/replies endpoints). Mirrors getNoteFromStatus so a fetched note
    // carries the same media as a delivered one.
    attachment: originalStatus.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .map((attachment) => getDocumentFromAttachment(attachment)),
    tag: originalStatus.tags
      .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
      .filter((tag) => tag !== null),
    // Mirrors getNoteFromStatus so a fetched note hides the same media as a
    // delivered one.
    sensitive:
      'sensitive' in originalStatus && Boolean(originalStatus.sensitive),
    replies: {
      id: `${originalStatus.id}/replies`,
      type: 'Collection',
      totalItems: originalStatus.replies.length,
      items: originalStatus.replies.map((reply) =>
        toActivityPubObject(Status.parse(reply))
      )
    },
    likes: {
      id: `${originalStatus.id}/likes`,
      type: 'Collection',
      totalItems: originalStatus.totalLikes
    },
    shares: {
      id: `${originalStatus.id}/shares`,
      type: 'Collection',
      totalItems: originalStatus.totalShares
    },
    ...quoteFields,
    ...getInteractionPolicyFields(originalStatus),

    published: getISOTimeUTC(originalStatus.createdAt),
    ...(hasStatusBeenEdited(originalStatus)
      ? { updated: getISOTimeUTC(originalStatus.updatedAt) }
      : null)
  })
}
