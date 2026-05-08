import { applyBlock } from '@/lib/actions/applyBlock'
import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { Block as BlockActivity } from '@/lib/types/activitypub'

interface ApplyRemoteBlockParams {
  database: Database
  activity: BlockActivity
  targetActorId: string
}

export const applyRemoteBlock = async ({
  database,
  activity,
  targetActorId
}: ApplyRemoteBlockParams) => {
  if (activity.object !== targetActorId) return null

  const actor = await recordActorIfNeeded({
    actorId: activity.actor,
    database
  })
  if (!actor) return null

  return applyBlock({
    database,
    actorId: actor.id,
    targetActorId,
    uri: activity.id
  })
}
