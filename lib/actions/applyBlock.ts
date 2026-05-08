import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'

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

  await Promise.all(
    follows
      .filter((follow) => Boolean(follow))
      .map((follow) =>
        database.updateFollowStatus({
          followId: follow!.id,
          status: FollowStatus.enum.Undo
        })
      )
  )

  return block
}
