import { UndoFollow } from '@/lib/activities/actions/undoFollow'
import { Storage } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'

interface UndoFollowRequestParams {
  storage: Storage
  request: UndoFollow
}

export const undoFollowRequest = async ({
  storage,
  request
}: UndoFollowRequestParams) => {
  const follow = await storage.getAcceptedOrRequestedFollow({
    actorId: request.object.actor,
    targetActorId: request.object.object
  })
  if (!follow) return false

  await storage.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Undo
  })
  return true
}
