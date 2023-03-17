import crypto from 'crypto'

import { getMentions } from '../link'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'
import { statusRecipientsCC, statusRecipientsTo } from './createNote'

interface CreatePollFromUserInputParams {
  text: string
  replyStatusId?: string
  currentActor: Actor
  choices: string[]
  storage: Storage
}
export const createPollFromUserInput = async ({
  text,
  replyStatusId,
  currentActor,
  choices = [],
  storage
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
}
