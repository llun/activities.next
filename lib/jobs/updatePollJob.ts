import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'

import { getContent, getSummary } from '../activities/entities/note'
import { StatusType } from '../models/status'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { UPDATE_POLL_JOB_NAME } from './names'

export const updatePollJob = createJobHandle(
  UPDATE_POLL_JOB_NAME,
  async (database, message) => {
    const question = Question.parse(message.data)
    const existingStatus = await database.getStatus({
      statusId: question.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Poll) {
      return
    }

    const compactQuestion = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...question
    })) as Question
    if (compactQuestion.type !== ENTITY_TYPE_QUESTION) {
      return
    }

    // TODO: Move Poll to schema
    const text = getContent(compactQuestion as unknown as Note)
    const summary = getSummary(compactQuestion as unknown as Note)
    await database.updatePoll({
      statusId: compactQuestion.id,
      summary,
      text,
      choices:
        compactQuestion.oneOf?.map((answer) => ({
          title: answer.name,
          totalVotes: answer.replies.totalItems
        })) ?? []
    })
  }
)
