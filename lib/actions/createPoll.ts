import crypto from 'crypto'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { addStatusToTimelines } from '@/lib/services/timelines'
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
}
export const createPollFromUserInput = async ({
  text,
  replyStatusId,
  currentActor,
  choices = [],
  database,
  endAt
}: CreatePollFromUserInputParams) => {
  const config = getConfig()
  const span = getSpan('actions', 'createPollFromUser', {
    replyStatusId
  })
  const replyStatus = replyStatusId
    ? await database.getStatus({ statusId: replyStatusId, withReplies: false })
    : undefined

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })

  const to = statusRecipientsTo(currentActor, replyStatus)
  const cc = statusRecipientsCC(currentActor, mentions, replyStatus)

  const createdPoll = await database.createPoll({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,
    actorId: currentActor.id,
    text: convertMarkdownText(config.host)(text),
    summary: '',
    to,
    cc,
    reply: replyStatus?.data.id || '',
    choices,
    endAt
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
