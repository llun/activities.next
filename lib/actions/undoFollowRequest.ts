import { extractFollowIdCandidates } from '@/lib/actions/resolveFollowFromActivity'
import { UndoFollow } from '@/lib/activities/undoFollow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import { actorIdsMatch } from '@/lib/utils/activitypub'

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
        if (actorIdsMatch(followById.actorId, request.actor)) {
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

  if (!actorIdsMatch(request.actor, actorId)) {
    return false
  }

  const strippedActorId = actorId.replace(/\/+$/, '')
  const strippedTargetActorId = targetActorId.replace(/\/+$/, '')

  const follow =
    (await database.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })) ??
    (await database.getAcceptedOrRequestedFollow({
      actorId: strippedActorId,
      targetActorId: strippedTargetActorId
    })) ??
    (await database.getAcceptedOrRequestedFollow({
      actorId: `${strippedActorId}/`,
      targetActorId: `${strippedTargetActorId}/`
    }))
  if (!follow) return false

  if (follow.status === FollowStatus.enum.Undo) {
    return true
  }

  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Undo
  })
  return true
}
