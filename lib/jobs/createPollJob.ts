import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'

import { recordActorIfNeeded } from '../actions/utils'
import { getContent, getSummary, getTags } from '../activities/entities/note'
import { addStatusToTimelines } from '../services/timelines'
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

    if (question.type !== ENTITY_TYPE_QUESTION) {
      return
    }

    // TODO: Move Poll to schema
    const text = getContent(question as unknown as Note)
    const summary = getSummary(question as unknown as Note)
    const choices = question.oneOf?.map((item) => item.name) ?? []

    const [, status] = await Promise.all([
      recordActorIfNeeded({
        actorId: question.attributedTo,
        database
      }),
      database.createPoll({
        id: question.id,
        url: question.url || question.id,

        actorId: question.attributedTo,

        text,
        summary,

        to: Array.isArray(question.to)
          ? question.to
          : [question.to].filter((item) => item),
        cc: Array.isArray(question.cc)
          ? question.cc
          : [question.cc].filter((item) => item),

        reply: question.inReplyTo || '',
        choices,
        endAt: question.endTime
          ? new Date(question.endTime).getTime()
          : new Date(question.published).getTime() +
            100 * 365 * 24 * 60 * 60 * 1000,
        createdAt: new Date(question.published).getTime()
      })
    ])

    const tags = getTags(question as unknown as Note)
    await Promise.all([
      addStatusToTimelines(database, status),
      ...tags.map((item) => {
        if (item.type === 'Emoji') {
          return database.createTag({
            statusId: question.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        return database.createTag({
          statusId: question.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])
  }
)
