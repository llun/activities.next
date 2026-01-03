import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@llun/activities.schema'
import { z } from 'zod'

import { recordActorIfNeeded } from '../actions/utils'
import {
  BaseNote,
  getAttachments,
  getContent,
  getSummary,
  getTags
} from '../activities/entities/note'
import { StatusType } from '../models/status'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { CREATE_NOTE_JOB_NAME } from './names'

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
    const note = BaseNoteSchema.parse(message.data)
    const attachments = getAttachments(note)

    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    const compactNote = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...note
    })) as BaseNote
    if (
      compactNote.type !== StatusType.enum.Note &&
      compactNote.type !== 'Image' &&
      compactNote.type !== 'Page' &&
      compactNote.type !== 'Article' &&
      compactNote.type !== 'Video'
    ) {
      return
    }

    const text = getContent(compactNote)
    const summary = getSummary(compactNote)

    const [, status] = await Promise.all([
      recordActorIfNeeded({ actorId: compactNote.attributedTo, database }),
      database.createNote({
        id: compactNote.id,
        url:
          typeof compactNote.url === 'string'
            ? compactNote.url
            : compactNote.id,

        actorId: compactNote.attributedTo,

        text,
        summary,

        to: Array.isArray(note.to)
          ? note.to
          : [note.to].filter((item): item is string => !!item),
        cc: Array.isArray(note.cc)
          ? note.cc
          : [note.cc].filter((item): item is string => !!item),

        reply: compactNote.inReplyTo || '',
        createdAt: new Date(compactNote.published).getTime()
      })
    ])

    const tags = getTags(note)

    await Promise.all([
      addStatusToTimelines(database, status),
      ...attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return
        return database.createAttachment({
          actorId: compactNote.attributedTo,
          statusId: compactNote.id,
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
            statusId: compactNote.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        return database.createTag({
          statusId: compactNote.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])
  }
)
