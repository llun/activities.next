import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'

import { compact } from '@/lib/utils/jsonld'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'

import { getContent, getSummary } from '../activities/entities/note'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../utils/trace'

interface UpdatePollParams {
  question: Question
  storage: Storage
}
export const updatePoll = async ({ question, storage }: UpdatePollParams) => {
  const span = getSpan('actions', 'updateQuestion', { status: question.id })
  const existingStatus = await storage.getStatus({
    statusId: question.id,
    withReplies: false
  })
  if (!existingStatus || existingStatus.type !== StatusType.enum.Poll) {
    span.end()
    return question
  }

  const compactQuestion = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...question
  })) as Question
  if (compactQuestion.type !== ENTITY_TYPE_QUESTION) {
    span.end()
    return null
  }

  // TODO: Move Poll to schema
  const text = getContent(compactQuestion as unknown as Note)
  const summary = getSummary(compactQuestion as unknown as Note)
  await storage.updatePoll({
    statusId: compactQuestion.id,
    summary,
    text,
    choices: compactQuestion.oneOf.map((answer) => ({
      title: answer.name,
      totalVotes: answer.replies.totalItems
    }))
  })
  span.end()
  return question
}
