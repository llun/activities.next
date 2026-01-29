import crypto from 'crypto'

import {
  getContent,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { ENTITY_TYPE_QUESTION, Note, Question } from '@/lib/types/activitypub'

import { recordActorIfNeeded } from '../actions/utils'
import { addStatusToTimelines } from '../services/timelines'
import { getQueue } from '../services/queue'
import { normalizeActivityPubContent } from '../utils/activitypub'
import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_JOB_NAME, FETCH_REMOTE_STATUS_JOB_NAME } from './names'

export const createPollJob = createJobHandle(
  CREATE_POLL_JOB_NAME,
  async (database, message) => {
    const parseResult = Question.safeParse(
      normalizeActivityPubContent(message.data)
    )
    if (!parseResult.success) {
      return
    }
    const question = parseResult.data

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
    const pollType = question.oneOf
      ? 'oneOf'
      : question.anyOf
        ? 'anyOf'
        : 'oneOf'
    const choices =
      question.oneOf?.map((item) => item.name) ??
      question.anyOf?.map((item) => item.name) ??
      []

    const [, status] = await Promise.all([
      recordActorIfNeeded({
        actorId: question.attributedTo,
        database
      }),
      database.createPoll({
        id: question.id,
        url: typeof question.url === 'string' ? question.url : question.id,

        actorId: question.attributedTo,

        text,
        summary,

        to: Array.isArray(question.to)
          ? question.to
          : [question.to].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),
        cc: Array.isArray(question.cc)
          ? question.cc
          : [question.cc].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),

        reply: getReply(question.inReplyTo) || '',
        choices,
        pollType,
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

    // Check if this poll has a parent that doesn't exist locally
    // If so, queue a job to fetch it
    const replyId = getReply(question.inReplyTo)
    if (replyId) {
      const parentStatus = await database.getStatus({
        statusId: replyId,
        withReplies: false
      })
      
      if (!parentStatus) {
        // Parent doesn't exist locally - queue job to fetch it
        // Fire-and-forget: don't block on this
        getQueue()
          .publish({
            id: crypto.randomUUID(),
            name: FETCH_REMOTE_STATUS_JOB_NAME,
            data: { statusUrl: replyId }
          })
          .catch(() => {
            // Silently fail - fetching parent is best effort
            // The main poll has already been created successfully
          })
      }
    }
  }
)
