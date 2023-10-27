import crypto from 'crypto'

import { getContent, getSummary, getTags } from '../activities/entities/note'
import { Question, QuestionEntity } from '../activities/entities/question'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { getMentions, paragraphText } from '../link'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { addStatusToTimelines } from '../timelines'
import { getSpan } from '../trace'
import { statusRecipientsCC, statusRecipientsTo } from './createNote'
import { recordActorIfNeeded } from './utils'

interface CreatePollParams {
  question: Question
  storage: Storage
}

export const createPoll = async ({ question, storage }: CreatePollParams) => {
  const span = getSpan('actions', 'createQuestion', { status: question.id })
  const existingStatus = await storage.getStatus({
    statusId: question.id,
    withReplies: false
  })
  if (existingStatus) {
    span.end()
    return question
  }

  const compactQuestion = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...question
  })) as Question
  if (compactQuestion.type !== QuestionEntity) {
    span.end()
    return null
  }

  const text = getContent(compactQuestion)
  const summary = getSummary(compactQuestion)
  const choices = compactQuestion.oneOf.map((item) => item.name)

  const [, status] = await Promise.all([
    recordActorIfNeeded({ actorId: compactQuestion.attributedTo, storage }),
    storage.createPoll({
      id: compactQuestion.id,
      url: compactQuestion.url || compactQuestion.id,

      actorId: compactQuestion.attributedTo,

      text,
      summary,

      to: Array.isArray(question.to)
        ? question.to
        : [question.to].filter((item) => item),
      cc: Array.isArray(question.cc)
        ? question.cc
        : [question.cc].filter((item) => item),

      reply: compactQuestion.inReplyTo || '',
      choices,
      endAt: new Date(compactQuestion.endTime).getTime(),
      createdAt: new Date(compactQuestion.published).getTime()
    })
  ])

  const tags = getTags(question)
  await Promise.all([
    addStatusToTimelines(storage, status),
    ...tags.map((item) => {
      if (item.type === 'Emoji') {
        return storage.createTag({
          statusId: compactQuestion.id,
          name: item.name,
          value: item.icon.url,
          type: 'emoji'
        })
      }
      return storage.createTag({
        statusId: compactQuestion.id,
        name: item.name || '',
        value: item.href,
        type: 'mention'
      })
    })
  ])
  span.end()
  return question
}

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
    text: paragraphText(text),
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
    span.end()
    return null
  }
}
