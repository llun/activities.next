import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getSpan } from '@/lib/utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text?: string
  summary?: string | null
  attachments?: PostBoxAttachment[]
  publish?: boolean
  status?: StatusNote
  database: Database
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  attachments,
  publish = true,
  status: preloadedStatus,
  database
}: UpdateNoteFromUserInput) => {
  const span = getSpan('actions', 'updateNoteFromUser', { statusId })
  const status = preloadedStatus ?? (await database.getStatus({ statusId }))
  if (
    !status ||
    status.id !== statusId ||
    status.type !== StatusType.enum.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const contentUpdatedStatus = await database.updateNote({
    statusId,
    summary: summary === undefined ? status.summary : summary?.trim() || null,
    text: text ?? status.text
  })
  if (!contentUpdatedStatus) {
    span.end()
    return null
  }

  if (attachments !== undefined) {
    await database.replaceStatusAttachments({
      actorId: currentActor.id,
      statusId,
      attachments: attachments.map((attachment) => ({
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name,
        mediaId: attachment.id
      }))
    })
  }

  const updatedStatus = await database.getStatus({ statusId })
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
