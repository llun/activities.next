import crypto from 'crypto'

import {
  getVisibilityFromReplyStatus,
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor, getMention } from '@/lib/models/actor'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

interface CreatePollFromUserInputParams {
  text: string
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

  // Determine effective visibility:
  // 1. Use explicit visibility if provided
  // 2. Inherit from reply status if replying
  // 3. Default to 'public'
  const effectiveVisibility =
    visibility ?? getVisibilityFromReplyStatus(replyStatus) ?? 'public'

  const to = statusRecipientsTo(
    currentActor,
    mentions,
    replyStatus,
    effectiveVisibility
  )
  const cc = statusRecipientsCC(
    currentActor,
    mentions,
    replyStatus,
    effectiveVisibility
  )

  const createdPoll = await database.createPoll({
    id: statusId,
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,
    actorId: currentActor.id,
    text: convertMarkdownText(config.host)(text),
    summary: '',
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
