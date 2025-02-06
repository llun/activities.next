import { Note } from '@llun/activities.schema'

import { getContent, getSummary } from '../activities/entities/note'
import { StatusType } from '../models/status'
import { compact } from '../utils/jsonld'
import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { createJobHandle } from './createJobHandle'
import { UPDATE_NOTE_JOB_NAME } from './names'

export const updateNoteJob = createJobHandle(
  UPDATE_NOTE_JOB_NAME,
  async (database, message) => {
    const note = Note.parse(message.data)
    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
      return
    }

    const compactNote = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...note
    })) as Note
    if (compactNote.type !== 'Note') {
      return
    }

    const text = getContent(compactNote)
    const summary = getSummary(compactNote)
    await database.updateNote({
      statusId: compactNote.id,
      summary,
      text
    })
  }
)
