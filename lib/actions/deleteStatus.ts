import { deleteStatus } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { getSpan } from '@/lib/utils/trace'

interface DeleteStatusFromUserInputParams {
  currentActor: Actor
  statusId: string
  database: Database
}
export const deleteStatusFromUserInput = async ({
  currentActor,
  statusId,
  database
}: DeleteStatusFromUserInputParams): Promise<void> => {
  const span = getSpan('actions', 'deleteNote', { statusId })
  const originalStatus = await database.getStatus({
    statusId,
    withReplies: false
  })
  if (!originalStatus) {
    span.end()
    return
  }

  // TODO: Get inboxes from status, instead of followers?
  const inboxes = await database.getFollowersInbox({
    targetActorId: currentActor.id
  })
  await Promise.all(
    inboxes.map((inbox) => {
      return deleteStatus({
        currentActor,
        inbox,
        statusId
      })
    })
  )
  await database.deleteStatus({ statusId })
  span.end()
}
