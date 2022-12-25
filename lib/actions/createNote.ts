import { Note, getAttachments } from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { createStatus, fromJson, toObject } from '../models/status'
import { Storage } from '../storage/types'
import { deliverTo } from './utils'

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({
  note,
  storage
}: CreateNoteParams): Promise<Note> => {
  const existingStatus = await storage.getStatus({ statusId: note.id })
  if (existingStatus) {
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note

  await storage.createStatus({
    id: compactNote.id,
    url: compactNote.url || compactNote.id,

    actorId: compactNote.attributedTo,

    type: compactNote.type,
    text: compactNote.content,
    summary: compactNote.summary || '',

    // Preserve URL here?
    to: Array.isArray(note.to) ? note.to : [note.to].filter((item) => item),
    cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter((item) => item),
    localRecipients: await deliverTo({ note: compactNote, storage }),

    reply: compactNote.inReplyTo || '',
    createdAt: new Date(compactNote.published).getTime()
  })

  const attachments = getAttachments(note)
  if (attachments) {
    await Promise.all([
      attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return

        await storage.createAttachment({
          statusId: compactNote.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url
        })
      })
    ])
  }
  return note
}

interface CreateNoteFromUserInputParams {
  text: string
  replyNoteId?: string
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  storage: Storage
}
export const createNoteFromUserInput = async ({
  text,
  replyNoteId,
  currentActor,
  attachments = [],
  storage
}: CreateNoteFromUserInputParams) => {
  const replyStatus = replyNoteId
    ? await storage.getStatus({ statusId: replyNoteId })
    : undefined
  const { status, mentions } = await createStatus({
    currentActor,
    text,
    replyStatus,
    storage
  })
  await storage.createStatus({
    id: status.id,
    url: status.url,

    actorId: status.actorId,

    type: status.type,
    text: status.text,
    summary: status.summary || '',

    to: status.to,
    cc: status.cc,
    localRecipients: status.localRecipients,

    reply: status.reply || '',
    createdAt: status.createdAt
  })
  const storedAttachmens = await Promise.all(
    attachments.map((attachment) =>
      storage.createAttachment({
        statusId: status.id,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name
      })
    )
  )
  return {
    note: toObject({
      status,
      mentions,
      replyStatus,
      attachments: storedAttachmens
    }),
    status,
    attachments: storedAttachmens
  }
}
