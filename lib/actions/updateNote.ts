import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getSpan } from '@/lib/utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text?: string
  summary?: string | null
  publish?: boolean
  database: Database
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  publish = true,
  database
}: UpdateNoteFromUserInput) => {
  const span = getSpan('actions', 'updateNoteFromUser', { statusId })
  const status = await database.getStatus({ statusId })
  if (
    !status ||
    status.type !== StatusType.enum.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const updatedStatus = await database.updateNote({
    statusId,
    summary: summary === undefined ? status.summary : summary?.trim() || null,
    text: text ?? status.text
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  await addStatusToTimelines(database, updatedStatus)

  if (publish) {
    await getQueue().publish({
      id: getHashFromString(statusId),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId
      }
    })
  }

  span.end()
  return updatedStatus
}
