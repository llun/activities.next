import {
  addQuoteFallbackToContent,
  getInteractionPolicyFields,
  getQuoteNoteFields
} from '@/lib/activities/quoteNoteFields'
import { Note, Question } from '@/lib/types/activitypub'
import {
  getDocumentFromAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
import type { StatusPoll } from '@/lib/types/domain/status'
import { getEmojiFromTag, getMentionFromTag } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Shared by inbox delivery and AP GET/outbox/replies. Transport-specific
// audience and updated fields are supplied by the caller.
export const getPollQuestion = (
  status: StatusPoll,
  options: {
    content?: string
    replies: (Note | Question | null)[]
    includeUpdated?: boolean
    audience?: string | null
  }
): Question => {
  const expired = status.endAt <= Date.now()
  const choices = status.choices.map((choice) => ({
    type: 'Note',
    name: choice.title,
    ...(!status.hideTotals || expired
      ? { replies: { type: 'Collection', totalItems: choice.totalVotes } }
      : {})
  }))
  const votersCount =
    status.votersCount ??
    (status.pollType === 'oneOf'
      ? status.choices.reduce((total, choice) => total + choice.totalVotes, 0)
      : undefined)

  return Question.parse({
    id: status.id,
    type: 'Question',
    summary: status.summary || null,
    url: status.url,
    attributedTo: status.actorId,
    to: status.to,
    cc: status.cc,
    inReplyTo: status.reply || null,
    content: addQuoteFallbackToContent(
      options.content ?? status.text,
      status.quote
    ),
    attachment: status.attachments
      .filter((attachment) => !isFitnessAttachment(attachment))
      .map(getDocumentFromAttachment),
    tag: status.tags
      .map((tag) => getMentionFromTag(tag) ?? getEmojiFromTag(tag))
      .filter((tag) => tag !== null),
    sensitive: Boolean(status.sensitive),
    ...(status.pollType === 'anyOf' ? { anyOf: choices } : { oneOf: choices }),
    replies: {
      id: `${status.id}/replies`,
      type: 'Collection',
      totalItems: status.replies.length,
      items: options.replies
    },
    likes: {
      id: `${status.id}/likes`,
      type: 'Collection',
      totalItems: status.totalLikes
    },
    shares: {
      id: `${status.id}/shares`,
      type: 'Collection',
      totalItems: status.totalShares
    },
    published: getISOTimeUTC(status.createdAt),
    endTime: getISOTimeUTC(status.endAt),
    ...(votersCount !== undefined ? { votersCount } : {}),
    ...(expired ? { closed: getISOTimeUTC(status.endAt) } : {}),
    ...getQuoteNoteFields(status.quote),
    ...getInteractionPolicyFields(status),
    ...(options.audience ? { audience: options.audience } : {}),
    ...(options.includeUpdated
      ? { updated: getISOTimeUTC(status.updatedAt) }
      : {})
  })
}
