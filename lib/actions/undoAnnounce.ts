import { undoAnnounce } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { StatusAnnounce, StatusType } from '@/lib/models/status'

interface UserUndoAnnounceParams {
  currentActor: Actor
  statusId: string
  database: Database
}
export const userUndoAnnounce = async ({
  currentActor,
  database,
  statusId
}: UserUndoAnnounceParams) => {
  // TODO: Find announce status from current actor and statusId
  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status) return null
  if (status.type !== StatusType.enum.Announce) return

  await database.deleteStatus({ statusId })
  // TODO: Get inboxes from status, instead of followers?
  const inboxes = await database.getFollowersInbox({
    targetActorId: currentActor.id
  })
  await Promise.all(
    inboxes.map((inbox) => {
      return undoAnnounce({
        currentActor,
        inbox,
        announce: status
      })
    })
  )
}
