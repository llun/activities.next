import { randomUUID } from 'node:crypto'

import { applyBlock } from '@/lib/actions/applyBlock'
import {
  BlockedFederationDomainError,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { SEND_BLOCK_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

export type BlockActorResult =
  | { type: 'forbidden' }
  | { type: 'not-found' }
  | { type: 'ok'; targetActorId: string }

/**
 * The block flow behind POST /api/v1/accounts/:id/block, shared with the bulk
 * import: record the target, block it and queue the federated Block.
 */
export const blockActor = async ({
  database,
  currentActor,
  requestedActorId
}: {
  database: Database
  currentActor: Actor
  requestedActorId: string
}): Promise<BlockActorResult> => {
  // The recorded row's id, which differs from the requested one when the
  // request named an alias URL (recordActorIfNeeded keys rows on the id the
  // actor's origin names).
  let targetActorId = requestedActorId
  if (requestedActorId !== currentActor.id) {
    let targetActor
    try {
      targetActor = await recordActorIfNeeded({
        actorId: requestedActorId,
        database
      })
    } catch (error) {
      if (error instanceof BlockedFederationDomainError) {
        return { type: 'forbidden' }
      }
      throw error
    }
    if (!targetActor) return { type: 'not-found' }
    targetActorId = targetActor.id
  }

  if (targetActorId !== currentActor.id) {
    const blockId = randomUUID()
    const uri = `${currentActor.id}#blocks/${blockId}`
    const block = await applyBlock({
      database,
      actorId: currentActor.id,
      targetActorId,
      uri
    })

    getQueue()
      .publish({
        id: getHashFromString(block.uri),
        name: SEND_BLOCK_JOB_NAME,
        data: {
          actorId: currentActor.id,
          targetActorId,
          uri: block.uri
        }
      })
      .catch((error) => {
        logger.warn({
          message: 'Failed to queue block federation',
          actorId: currentActor.id,
          targetActorId,
          error
        })
      })
  }

  return { type: 'ok', targetActorId }
}
