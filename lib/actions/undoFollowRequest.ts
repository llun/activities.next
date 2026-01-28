import { UndoFollow } from '@/lib/activities/undoFollow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'

interface UndoFollowRequestParams {
  database: Database
  request: UndoFollow
}

export const undoFollowRequest = async ({
  database,
  request
}: UndoFollowRequestParams) => {
  const follow = await database.getAcceptedOrRequestedFollow({
    actorId: request.object.actor,
    targetActorId: request.object.object
  })
  if (!follow) return false

  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Undo
  })
  return true
}
