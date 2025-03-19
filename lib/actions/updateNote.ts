import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getSpan } from '@/lib/utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text: string
  summary?: string
  database: Database
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
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
    summary,
    text
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  await getQueue().publish({
    id: getHashFromString(statusId),
    name: SEND_UPDATE_NOTE_JOB_NAME,
    data: {
      actorId: currentActor.id,
      statusId
    }
  })

  span.end()
  return updatedStatus
}
