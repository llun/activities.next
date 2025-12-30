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
    const compactObject = (await compact({
      '@context': ACTIVITY_STREAM_URL,
      ...(message.data as Record<string, unknown>)
    })) as Record<string, unknown>
    const noteResult = Note.safeParse(compactObject)
    const objectType = compactObject.type
    const isMediaObject =
      objectType === 'Image' || objectType === 'Video' || objectType === 'Note'
    if (!noteResult.success && !isMediaObject) {
      return
    }

    const statusId =
      typeof compactObject.id === 'string' ? compactObject.id : null
    if (!statusId) return

    const existingStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
      return
    }
    if (objectType !== 'Note' && !isMediaObject) {
      return
    }

    const text = getContent(compactObject as Note)
    const summary = getSummary(compactObject as Note)
    await database.updateNote({
      statusId,
      summary,
      text
    })
  }
)
