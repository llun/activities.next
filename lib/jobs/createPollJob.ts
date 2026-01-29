import crypto from 'crypto'
import { z } from 'zod'

import {
  getContent,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { ENTITY_TYPE_QUESTION, Note, Question } from '@/lib/types/activitypub'
import { Collection } from '@/lib/types/activitypub/collections'

import { recordActorIfNeeded } from '../actions/utils'
import { addStatusToTimelines } from '../services/timelines'
import { normalizeActivityPubContent } from '../utils/activitypub'
import { createJobHandle } from './createJobHandle'
import { CREATE_POLL_JOB_NAME, FETCH_REMOTE_STATUS_JOB_NAME } from './names'

// Helper to extract reply URLs from ActivityPub replies collection
const getReplyUrls = (replies: z.infer<typeof Collection> | null | undefined): string[] => {
  if (!replies) return []
  
  try {
    // Handle CollectionWithItems format
    if ('items' in replies && replies.items) {
      const items = Array.isArray(replies.items) ? replies.items : [replies.items]
      return items
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 10) // Limit to first 10 replies to avoid overloading
    }
    
    // Handle CollectionWithFirstPage format
    if ('first' in replies && replies.first && 'items' in replies.first) {
      const items = Array.isArray(replies.first.items) 
        ? replies.first.items 
        : [replies.first.items]
      return items
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 10) // Limit to first 10 replies
    }
  } catch (_error) {
    // Silently fail if we can't parse the collection
  }
  
  return []
}

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
        // Use dynamic import to avoid circular dependency
        import('../services/queue')
          .then(({ getQueue }) => {
            return getQueue().publish({
              id: crypto.randomUUID(),
              name: FETCH_REMOTE_STATUS_JOB_NAME,
              data: { statusUrl: replyId }
            })
          })
          .catch(() => {
            // Silently fail - fetching parent is best effort
            // The main poll has already been created successfully
          })
      }
    }

    // Check if this poll has replies that don't exist locally
    // If so, queue jobs to fetch them
    const replyUrls = getReplyUrls(question.replies)
    if (replyUrls.length > 0) {
      // Check which replies don't exist locally and queue fetch jobs
      import('../services/queue')
        .then(async ({ getQueue }) => {
          const queue = getQueue()
          
          // Check each reply and queue fetch if it doesn't exist
          for (const replyUrl of replyUrls) {
            try {
              const existingReply = await database.getStatus({
                statusId: replyUrl,
                withReplies: false
              })
              
              if (!existingReply) {
                // Reply doesn't exist locally - queue job to fetch it
                await queue.publish({
                  id: crypto.randomUUID(),
                  name: FETCH_REMOTE_STATUS_JOB_NAME,
                  data: { statusUrl: replyUrl }
                })
              }
            } catch (_error) {
              // Silently fail for individual replies
            }
          }
        })
        .catch(() => {
          // Silently fail - fetching replies is best effort
        })
    }
  }
)
