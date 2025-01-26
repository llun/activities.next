import { deleteStatus } from '@/lib/activities'
import { Storage } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { getSpan } from '@/lib/utils/trace'

interface DeleteStatusFromUserInputParams {
  currentActor: Actor
  statusId: string
  storage: Storage
}
export const deleteStatusFromUserInput = async ({
  currentActor,
  statusId,
  storage
}: DeleteStatusFromUserInputParams): Promise<void> => {
  const span = getSpan('actions', 'deleteNote', { statusId })
  const originalStatus = await storage.getStatus({
    statusId,
    withReplies: false
  })
  if (!originalStatus) {
    span.end()
    return
  }

  // TODO: Get inboxes from status, instead of followers?
  const inboxes = await storage.getFollowersInbox({
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
  await storage.deleteStatus({ statusId })
  span.end()
}
