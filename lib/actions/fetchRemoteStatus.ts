import { z } from 'zod'

import { getNote } from '@/lib/activities'
import {
  BaseNote,
  getAttachments,
  getContent,
  getReply,
  getSummary,
  getTags
} from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

import { recordActorIfNeeded } from './utils'

/**
 * Fetches a remote status and stores it in the local database.
 * Similar to createNoteJob but for on-demand fetching.
 */
export async function fetchAndStoreRemoteStatus(
  database: Database,
  statusUrl: string
): Promise<boolean> {
  try {
    // Fetch the note from remote server
    const rawNote = await getNote({ statusId: statusUrl })
    if (!rawNote) {
      logger.info({ statusUrl }, 'Failed to fetch remote status')
      return false
    }

    // Parse and validate the note with Zod schema
    const BaseNoteSchema = z.union([
      Note,
      ImageContent,
      PageContent,
      ArticleContent,
      VideoContent
    ])
    const note = BaseNoteSchema.parse(
      normalizeActivityPubContent(rawNote)
    ) as BaseNote

    // Check if we already have this status
    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (existingStatus) {
      logger.info({ statusId: note.id }, 'Status already exists')
      return true
    }

    // Validate note type
    const noteType = note.type
    if (
      noteType !== StatusType.enum.Note &&
      noteType !== 'Image' &&
      noteType !== 'Page' &&
      noteType !== 'Article' &&
      noteType !== 'Video'
    ) {
      logger.info({ type: noteType }, 'Unsupported note type')
      return false
    }

    const text = getContent(note)
    const summary = getSummary(note)
    const attachments = getAttachments(note)
    const tags = getTags(note)

    // Record actor if needed and create the note
    await recordActorIfNeeded({ actorId: note.attributedTo, database })

    await database.createNote({
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

    // Create attachments and tags
    await Promise.all([
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

    logger.info({ statusId: note.id }, 'Successfully fetched and stored remote status')
    return true
  } catch (error) {
    logger.error({ error, statusUrl }, 'Error fetching remote status')
    return false
  }
}
