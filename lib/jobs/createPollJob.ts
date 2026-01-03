import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'

import { recordActorIfNeeded } from '../actions/utils'
import { getContent, getSummary, getTags } from '../activities/entities/note'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_JOB_NAME } from './names'

export const createPollJob = createJobHandle(
  CREATE_POLL_JOB_NAME,
  async (database, message) => {
    const question = Question.parse(message.data)
    const existingStatus = await database.getStatus({
      statusId: question.id,
      withReplies: false
    })
    if (existingStatus) {
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
    const choices = compactQuestion.oneOf?.map((item) => item.name) ?? []

    const [, status] = await Promise.all([
      recordActorIfNeeded({
        actorId: compactQuestion.attributedTo,
        database
      }),
      database.createPoll({
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
        endAt: compactQuestion.endTime
          ? new Date(compactQuestion.endTime).getTime()
          : Date.now(),
        createdAt: new Date(compactQuestion.published).getTime()
      })
    ])

    const tags = getTags(question as unknown as Note)
    await Promise.all([
      addStatusToTimelines(database, status),
      ...tags.map((item) => {
        if (item.type === 'Emoji') {
          return database.createTag({
            statusId: compactQuestion.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        return database.createTag({
          statusId: compactQuestion.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])
  }
)
