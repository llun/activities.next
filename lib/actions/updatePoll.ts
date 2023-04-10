import { getContent } from '../activities/entities/note'
import { Question, QuestionEntity } from '../activities/entities/question'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'

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
  if (!existingStatus || existingStatus.type !== StatusType.Poll) {
    span?.finish()
    return question
  }

  const compactQuestion = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...question
  })) as Question
  if (compactQuestion.type !== QuestionEntity) {
    span?.finish()
    return null
  }

  const text = getContent(compactQuestion)
  await storage.updatePoll({
    statusId: compactQuestion.id,
    text,
    choices: compactQuestion.oneOf.map((answer) => ({
      title: answer.name,
      totalVotes: answer.replies.totalItems
    }))
  })
  span?.finish()
  return question
}
