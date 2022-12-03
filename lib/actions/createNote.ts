import { Note } from '../activities/entities/note'
import { fromJson } from '../models/status'
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
