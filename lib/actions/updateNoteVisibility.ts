import { Database } from '@/lib/database/types'
import { statusRecipientsCC, statusRecipientsTo } from '@/lib/actions/createNote'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
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

  const to = statusRecipientsTo(currentActor, [], null, visibility)
  const cc = statusRecipientsCC(currentActor, [], null, visibility)
  const updatedStatus = await database.updateNoteVisibility({
    statusId,
    to,
    cc
  })
  if (!updatedStatus) {
    span.end()
    return null
  }
  span.end()
  return updatedStatus
}
