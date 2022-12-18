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

  const status = fromJson(note)

  // TODO: Put this in fromJson?
  status.localRecipients = await deliverTo({ note: compactNote, storage })

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
  await storage.createStatus({ status })
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
