import { Note, NoteEntity, getContent } from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'

interface UpdateNoteParams {
  note: Note
  storage: Storage
}
export const updatePoll = async ({ note, storage }: UpdateNoteParams) => {
  const span = getSpan('actions', 'updateNote', { status: note.id })
  const existingStatus = await storage.getStatus({
    statusId: note.id,
    withReplies: false
  })
  if (!existingStatus || existingStatus.type !== StatusType.Poll) {
    span?.finish()
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== NoteEntity) {
    span?.finish()
    return null
  }

  const text = getContent(compactNote)
  console.log(text)
  span?.finish()
  return note
}
