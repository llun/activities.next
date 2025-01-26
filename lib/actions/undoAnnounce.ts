import { undoAnnounce } from '@/lib/activities'
import { Storage } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { StatusAnnounce, StatusType } from '@/lib/models/status'

interface UserUndoAnnounceParams {
  currentActor: Actor
  statusId: string
  storage: Storage
}
export const userUndoAnnounce = async ({
  currentActor,
  storage,
  statusId
}: UserUndoAnnounceParams) => {
  // TODO: Find announce status from current actor and statusId
  const status = await storage.getStatus({ statusId, withReplies: false })
  if (!status) return null
  if (status.data.type !== StatusType.enum.Announce) return

  await storage.deleteStatus({ statusId })
  // TODO: Get inboxes from status, instead of followers?
  const inboxes = await storage.getFollowersInbox({
    targetActorId: currentActor.id
  })
  await Promise.all(
    inboxes.map((inbox) => {
      return undoAnnounce({
        currentActor,
        inbox,
        announce: status.data as StatusAnnounce
      })
    })
  )
}
