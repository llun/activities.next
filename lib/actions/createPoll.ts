import crypto from 'crypto'

import {
  getExplicitMentions,
  getVisibilityFromReplyStatus,
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

interface CreatePollFromUserInputParams {
  text: string
  summary?: string | null
  replyStatusId?: string
  currentActor: Actor
  choices: string[]
  database: Database
  endAt: number
  pollType?: 'oneOf' | 'anyOf'
  visibility?: MastodonVisibility
}
export const createPollFromUserInput = async ({
  text,
  summary,
  replyStatusId,
  currentActor,
  choices = [],
  database,
  endAt,
  pollType,
  visibility
}: CreatePollFromUserInputParams) => {
  const config = getConfig()
  const span = getSpan('actions', 'createPollFromUser', {
    replyStatusId
  })
  const replyStatus = replyStatusId
    ? await database.getStatus({ statusId: replyStatusId, withReplies: false })
    : null

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })
  const explicitMentions = getExplicitMentions(text, mentions)

  // Determine effective visibility:
  // 1. Use explicit visibility if provided
  // 2. Inherit from reply status if replying
  // 3. Default to 'public'
  const replyVisibility = getVisibilityFromReplyStatus(replyStatus)
  const effectiveVisibility = visibility ?? replyVisibility ?? 'public'
  const isReplyingToDirectThread = replyStatus && replyVisibility === 'direct'
  if (
    effectiveVisibility === 'direct' &&
    explicitMentions.length === 0 &&
    !isReplyingToDirectThread
  ) {
    span.end()
    return null
  }
  const recipientMentions =
    effectiveVisibility === 'direct' &&
    replyStatus &&
    replyVisibility !== 'direct'
      ? explicitMentions
      : mentions

  const to = statusRecipientsTo(
    currentActor,
    recipientMentions,
    replyStatus,
    effectiveVisibility,
    replyVisibility
  )
  const cc = statusRecipientsCC(
    currentActor,
    recipientMentions,
    replyStatus,
    effectiveVisibility,
    replyVisibility
  )

  const createdPoll = await database.createPoll({
    id: statusId,
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,
    actorId: currentActor.id,
    text: convertMarkdownText(config.host)(text),
    summary: summary?.trim() || null,
    to,
    cc,
    reply: replyStatus?.id || '',
    choices,
    endAt,
    pollType
  })

  await Promise.all([
    addStatusToTimelines(database, createdPoll),
    ...mentions.map((mention) =>
      database.createTag({
        statusId,
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    )
  ])

  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status) {
    span.end()
    return null
  }
}
