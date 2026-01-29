import crypto from 'crypto'
import { z } from 'zod'

import {
  BaseNote,
  getAttachments,
  getContent,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { Collection } from '@/lib/types/activitypub/collections'
import { StatusType } from '@/lib/types/domain/status'

import { recordActorIfNeeded } from '../actions/utils'
import { addStatusToTimelines } from '../services/timelines'
import { normalizeActivityPubContent } from '../utils/activitypub'
import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME, FETCH_REMOTE_STATUS_JOB_NAME } from './names'

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

export const createNoteJob = createJobHandle(
  CREATE_NOTE_JOB_NAME,
  async (database, message) => {
    const BaseNoteSchema = z.union([
      Note,
      ImageContent,
      PageContent,
      ArticleContent,
      VideoContent
    ])
    const note = BaseNoteSchema.parse(
      normalizeActivityPubContent(message.data)
    ) as BaseNote
    const attachments = getAttachments(note)

    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    if (
      note.type !== StatusType.enum.Note &&
      note.type !== 'Image' &&
      note.type !== 'Page' &&
      note.type !== 'Article' &&
      note.type !== 'Video'
    ) {
      return
    }

    const text = getContent(note)
    const summary = getSummary(note)

    const [, status] = await Promise.all([
      recordActorIfNeeded({ actorId: note.attributedTo, database }),
      database.createNote({
        id: note.id,
        url: typeof note.url === 'string' ? note.url : note.id,

        actorId: note.attributedTo,

        text,
        summary,

        to: Array.isArray(note.to)
          ? note.to
          : [note.to].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),
        cc: Array.isArray(note.cc)
          ? note.cc
          : [note.cc].filter(
              (item): item is string => typeof item === 'string' && item !== ''
            ),

        reply: getReply(note.inReplyTo) || '',
        createdAt: new Date(note.published).getTime()
      })
    ])

    const tags = getTags(note)

    await Promise.all([
      addStatusToTimelines(database, status),
      ...attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return
        return database.createAttachment({
          actorId: note.attributedTo,
          statusId: note.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url
        })
      }),
      ...tags.map((item) => {
        if (item.type === 'Emoji') {
          return database.createTag({
            statusId: note.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        return database.createTag({
          statusId: note.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])

    // Check if this note has a parent that doesn't exist locally
    // If so, queue a job to fetch it
    const replyId = getReply(note.inReplyTo)
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
            // The main note has already been created successfully
          })
      }
    }

    // Check if this note has replies that don't exist locally
    // If so, queue jobs to fetch them
    const replyUrls = getReplyUrls(note.replies)
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
