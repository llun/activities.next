import { Note } from '../activities/entities/note'
import { Actor } from '../models/actor'
import { createStatus, fromJson, toObject } from '../models/status'
import { Storage } from '../storage/types'

const getAttachments = (object: Note) => {
  if (!object.attachment) return null
  if (Array.isArray(object.attachment)) return object.attachment
  return [object.attachment]
}

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({
  note,
  storage
}: CreateNoteParams): Promise<Note> => {
  const status = fromJson(note)
  await storage.createStatus({ status })

  const attachments = getAttachments(note)
  if (attachments) {
    await Promise.all([
      attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return

        await storage.createAttachment({
          statusId: status.id,
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
  storage: Storage
}
export const createNoteFromUserInput = async ({
  text,
  replyNoteId,
  currentActor,
  storage
}: CreateNoteFromUserInputParams) => {
  const replyStatus = replyNoteId
    ? await storage.getStatus({ statusId: replyNoteId })
    : undefined
  const { status, mentions } = await createStatus({
    currentActor,
    text,
    replyStatus
  })
  await storage.createStatus({ status })
  return toObject({ status, mentions, replyStatus })
}
