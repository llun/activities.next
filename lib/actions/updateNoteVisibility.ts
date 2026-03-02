import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getMentionFromTag } from '@/lib/types/domain/tag'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { getSpan } from '@/lib/utils/trace'

interface UpdateNoteVisibilityFromUserInput {
  statusId: string
  currentActor: Actor
  visibility: MastodonVisibility
  database: Database
}

export const updateNoteVisibilityFromUserInput = async ({
  statusId,
  currentActor,
  visibility,
  database
}: UpdateNoteVisibilityFromUserInput) => {
  const span = getSpan('actions', 'updateNoteVisibilityFromUser', { statusId })
  const status = await database.getStatus({ statusId })
  if (
    !status ||
    status.type !== StatusType.enum.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const mentions = status.tags
    .filter((tag) => tag.type === 'mention')
    .map((tag) => getMentionFromTag(tag))

  const replyStatus = status.reply
    ? await database.getStatus({ statusId: status.reply, withReplies: false })
    : null

  const to = statusRecipientsTo(currentActor, mentions, replyStatus, visibility)
  const cc = statusRecipientsCC(currentActor, mentions, replyStatus, visibility)
  const updatedStatus = await database.updateNoteVisibility({
    statusId,
    to,
    cc
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  await addStatusToTimelines(database, updatedStatus)

  await getQueue().publish({
    id: getHashFromString(statusId),
    name: SEND_UPDATE_NOTE_JOB_NAME,
    data: { actorId: currentActor.id, statusId }
  })

  span.end()
  return updatedStatus
}
