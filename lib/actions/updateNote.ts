import { persistEmojiTagsForStatus } from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
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
  sensitive?: boolean
  language?: string | null
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
  sensitive,
  language,
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

  let updatedStatus = await database.updateNote({
    statusId,
    summary: summary === undefined ? status.summary : summary?.trim() || null,
    text: text ?? status.text,
    ...(attachments !== undefined ? { attachments } : {}),
    ...(sensitive !== undefined ? { sensitive } : {}),
    ...(language !== undefined ? { language } : {})
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  // Re-sync emoji tags when the text changes so newly added `:shortcode:`
  // tokens federate and removed ones stop federating, then re-fetch so the
  // returned status and the timeline cache reflect the re-synced tags (mirroring
  // createNoteFromUserInput).
  if (text !== undefined) {
    await database.deleteStatusTagsByType({ statusId, type: 'emoji' })
    await persistEmojiTagsForStatus({ database, statusId, text })

    // Re-detect the content language alongside the edit; the previous
    // detection (if any) is stale once the text changes — persistDetectedLanguage
    // clears the old row when the new text no longer detects confidently.
    await persistDetectedLanguage({ database, statusId, text })

    updatedStatus = (await database.getStatus({ statusId })) ?? updatedStatus
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

    // Notify the authors of accepted quotes of this status that a post they
    // quoted was edited. Only published (federated) edits notify quoters.
    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: statusId,
      sourceActorId: currentActor.id,
      sourceActor: currentActor
    })
  }

  span.end()
  return updatedStatus
}
