import { extractFollowIdCandidates } from '@/lib/actions/resolveFollowFromActivity'
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
  if (request.object.id) {
    const candidateIds = extractFollowIdCandidates(request.object.id)
    for (const candidateId of candidateIds) {
      const followById = await database.getFollowFromId({
        followId: candidateId
      })
      if (followById) {
        if (
          !request.actor ||
          followById.actorId === request.actor ||
          followById.actorId.replace(/\/+$/, '') ===
            request.actor.replace(/\/+$/, '')
        ) {
          if (followById.status === FollowStatus.enum.Undo) {
            return true
          }
          await database.updateFollowStatus({
            followId: followById.id,
            status: FollowStatus.enum.Undo
          })
          return true
        }
      }
    }
  }

  const actorId = request.object.actor
  const targetActorId = request.object.object

  const follow =
    (await database.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })) ??
    (await database.getAcceptedOrRequestedFollow({
      actorId: actorId.replace(/\/+$/, ''),
      targetActorId: targetActorId.replace(/\/+$/, '')
    }))
  if (!follow) return false

  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Undo
  })
  return true
}
