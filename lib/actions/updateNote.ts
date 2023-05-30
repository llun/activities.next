import {
  Note,
  NoteEntity,
  getContent,
  getSummary
} from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'

interface UpdateNoteParams {
  note: Note
  storage: Storage
}
export const updateNote = async ({ note, storage }: UpdateNoteParams) => {
  const span = getSpan('actions', 'updateNote', { status: note.id })
  const existingStatus = await storage.getStatus({
    statusId: note.id,
    withReplies: false
  })
  if (!existingStatus || existingStatus.type !== StatusType.Note) {
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
  const summary = getSummary(compactNote)
  await storage.updateNote({
    statusId: compactNote.id,
    summary,
    text
  })
  span?.finish()
  return note
}

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text: string
  summary?: string
  storage: Storage
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  storage
}: UpdateNoteFromUserInput) => {
  const status = await storage.getStatus({ statusId })
  if (!status) return null
  if (status.type !== StatusType.Note) return null
  if (status.actorId !== currentActor.id) return null

  const updatedNote = await storage.updateNote({ statusId, summary, text })
  if (!updatedNote) return null

  return status
}
