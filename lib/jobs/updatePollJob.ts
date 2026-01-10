import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'

import { getContent, getSummary } from '../activities/entities/note'
import { StatusType } from '../models/status'
import { normalizeActivityPubContent } from '../utils/activitypub'
import { createJobHandle } from './createJobHandle'
import { UPDATE_POLL_JOB_NAME } from './names'

export const updatePollJob = createJobHandle(
  UPDATE_POLL_JOB_NAME,
  async (database, message) => {
    const question = Question.parse(normalizeActivityPubContent(message.data))
    const existingStatus = await database.getStatus({
      statusId: question.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Poll) {
      return
    }

    if (question.type !== ENTITY_TYPE_QUESTION) {
      return
    }

    // TODO: Move Poll to schema
    const text = getContent(question as unknown as Note)
    const summary = getSummary(question as unknown as Note)
    await database.updatePoll({
      statusId: question.id,
      summary,
      text,
      choices:
        question.oneOf?.map((answer) => ({
          title: answer.name,
          totalVotes: answer.replies.totalItems
        })) ?? []
    })
  }
)
