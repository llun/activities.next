import { Note } from '@llun/activities.schema'
import { z } from 'zod'

import { recordActorIfNeeded } from '../actions/utils'
import {
  getAttachments,
  getContent,
  getSummary,
  getTags
} from '../activities/entities/note'
import { StatusType } from '../models/status'
import { JobHandle } from '../services/queue/type'
import { addStatusToTimelines } from '../services/timelines'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'

export const CREATE_NOTE_JOB_NAME = 'CreateNoteJob'
export const CreateNoteJobMessage = z.object({
  name: z.literal(CREATE_NOTE_JOB_NAME),
  data: Note
})
export type CreateNoteJobMessage = z.infer<typeof CreateNoteJobMessage>

export const createNoteJob: JobHandle = createJobHandle(
  CREATE_NOTE_JOB_NAME,
  async (storage, message) => {
    if (message.name !== CREATE_NOTE_JOB_NAME) return

    const note = message.data
    const existingStatus = await storage.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (existingStatus) {
      return
    }

    const compactNote = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...note
    })) as Note
    if (compactNote.type !== StatusType.enum.Note) {
      return
    }

    const text = getContent(compactNote)
    const summary = getSummary(compactNote)

    const [, status] = await Promise.all([
      recordActorIfNeeded({ actorId: compactNote.attributedTo, storage }),
      storage.createNote({
        id: compactNote.id,
        url: compactNote.url || compactNote.id,

        actorId: compactNote.attributedTo,

        text,
        summary,

        to: Array.isArray(note.to) ? note.to : [note.to].filter((item) => item),
        cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter((item) => item),

        reply: compactNote.inReplyTo || '',
        createdAt: new Date(compactNote.published).getTime()
      })
    ])

    const attachments = getAttachments(note)
    const tags = getTags(note)

    await Promise.all([
      addStatusToTimelines(storage, status),
      ...attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return
        return storage.createAttachment({
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
          return storage.createTag({
            statusId: compactNote.id,
            name: item.name,
            value: item.icon.url,
            type: 'emoji'
          })
        }
        return storage.createTag({
          statusId: compactNote.id,
          name: item.name || '',
          value: item.href,
          type: 'mention'
        })
      })
    ])
  }
)
