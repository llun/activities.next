import { deleteStatus } from '../activities'
import { Actor } from '../models/actor'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'

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

  await storage.deleteStatus({ statusId })
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
  span.end()
}
