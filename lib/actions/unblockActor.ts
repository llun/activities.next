import { applyUnblock } from '@/lib/actions/applyUnblock'
import { Database } from '@/lib/database/types'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

/**
 * The unblock flow behind POST /api/v1/accounts/:id/unblock, shared with the
 * bulk import. Returns false for an unknown target the actor does not block
 * (the route answers 404).
 */
export const unblockActor = async ({
  database,
  currentActor,
  targetActorId
}: {
  database: Database
  currentActor: Actor
  targetActorId: string
}): Promise<boolean> => {
  if (targetActorId === currentActor.id) return true

  const existingBlock = await database.getBlock({
    actorId: currentActor.id,
    targetActorId
  })

  if (!existingBlock) {
    const targetActor = await database.getActorFromId({
      id: targetActorId
    })
    if (!targetActor) return false
  }

  if (existingBlock) {
    await applyUnblock({
      database,
      actorId: currentActor.id,
      targetActorId
    })

    getQueue()
      .publish({
        id: getHashFromString(`${existingBlock.uri}/undo`),
        name: SEND_UNBLOCK_JOB_NAME,
        data: {
          actorId: currentActor.id,
          block: existingBlock
        }
      })
      .catch((error) => {
        logger.warn({
          message: 'Failed to queue unblock federation',
          actorId: currentActor.id,
          targetActorId,
          error
        })
      })
  }

  return true
}
