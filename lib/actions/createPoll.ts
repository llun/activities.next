import crypto from 'crypto'
import { encode } from 'html-entities'

import { getMentions, linkifyText, paragraphText } from '../link'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { addStatusToTimelines } from '../timelines'
import { getSpan } from '../trace'
import { statusRecipientsCC, statusRecipientsTo } from './createNote'

interface CreatePollFromUserInputParams {
  text: string
  replyStatusId?: string
  currentActor: Actor
  choices: string[]
  storage: Storage
  endAt: number
}
export const createPollFromUserInput = async ({
  text,
  replyStatusId,
  currentActor,
  choices = [],
  storage,
  endAt
}: CreatePollFromUserInputParams) => {
  const span = getSpan('actions', 'createPollFromUser', {
    replyStatusId
  })
  const replyStatus = replyStatusId
    ? await storage.getStatus({ statusId: replyStatusId, withReplies: false })
    : undefined

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })

  const to = statusRecipientsTo(currentActor, replyStatus)
  const cc = statusRecipientsCC(currentActor, mentions, replyStatus)

  const createdPoll = await storage.createPoll({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,
    actorId: currentActor.id,
    text: paragraphText(await linkifyText(encode(text))),
    summary: '',
    to,
    cc,
    reply: replyStatus?.data.id || '',
    choices,
    endAt
  })

  await Promise.all([
    addStatusToTimelines(storage, createdPoll),
    ...mentions.map((mention) =>
      storage.createTag({
        statusId,
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    )
  ])

  const status = await storage.getStatus({ statusId, withReplies: false })
  if (!status) {
    span?.finish()
    return null
  }
}
