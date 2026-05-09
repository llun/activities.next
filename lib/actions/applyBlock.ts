import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

interface ApplyBlockParams {
  database: Database
  actorId: string
  targetActorId: string
  uri: string
}

export const applyBlock = async ({
  database,
  actorId,
  targetActorId,
  uri
}: ApplyBlockParams) => {
  const block = await database.createBlock({
    actorId,
    targetActorId,
    uri
  })

  const follows = await Promise.all([
    database.getAcceptedOrRequestedFollow({ actorId, targetActorId }),
    database.getAcceptedOrRequestedFollow({
      actorId: targetActorId,
      targetActorId: actorId
    })
  ])

  const followsToUndo = follows.filter((follow): follow is Follow =>
    Boolean(follow)
  )

  await Promise.all(
    followsToUndo.map((follow) =>
      database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })
    )
  )

  const followsToFederate = (
    await Promise.all(
      followsToUndo.map(async (follow) => {
        const followActor = await database.getActorFromId({
          id: follow.actorId
        })
        return followActor?.privateKey ? follow : null
      })
    )
  ).filter((follow): follow is Follow => Boolean(follow))

  const results = await Promise.allSettled(
    followsToFederate.map((follow) =>
      getQueue().publish({
        id: getHashFromString(`${follow.id}/undo`),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: {
          actorId: follow.actorId,
          follow
        }
      })
    )
  )

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const follow = followsToFederate[index]
      logger.warn({
        message: 'Failed to queue Undo Follow federation for block',
        actorId: follow.actorId,
        targetActorId: follow.targetActorId,
        followId: follow.id,
        error: result.reason
      })
    }
  })

  return block
}
