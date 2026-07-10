import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

// Mastodon severs domain-block relationships in a background worker; at this
// server's scale a synchronous loop is fine, but it must stay bounded so one
// request cannot spin on a pathological follow count. Marking a follow Undo
// removes it from the next batch fetch, so plain re-fetching converges.
const SEVER_BATCH_SIZE = 100
const MAX_SEVER_BATCHES = 10

interface ApplyDomainBlockParams {
  database: Database
  actorId: string
  domain: string
}

export const applyDomainBlock = async ({
  database,
  actorId,
  domain
}: ApplyDomainBlockParams) => {
  const block = await database.createActorDomainBlock({ actorId, domain })

  let severedCount = 0
  let batches = 0
  while (batches < MAX_SEVER_BATCHES) {
    batches += 1
    const follows = await database.getAcceptedOrRequestedFollowsWithDomain({
      actorId,
      domain,
      limit: SEVER_BATCH_SIZE
    })
    if (follows.length === 0) break

    await Promise.all(
      follows.map((follow) =>
        database.updateFollowStatus({
          followId: follow.id,
          status: FollowStatus.enum.Undo
        })
      )
    )
    severedCount += follows.length

    // Federate Undo Follow only for severed follows whose actor is local
    // (has a signing key) — i.e. the caller's own outbound follows. Dropped
    // remote followers are severed locally without federation, matching
    // applyBlock.
    const followsToFederate = (
      await Promise.all(
        follows.map(async (follow) => {
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
          message: 'Failed to queue Undo Follow federation for domain block',
          actorId: follow.actorId,
          targetActorId: follow.targetActorId,
          followId: follow.id,
          error: result.reason
        })
      }
    })

    if (follows.length < SEVER_BATCH_SIZE) break
  }

  if (severedCount > 0) {
    logger.info({
      message: 'Severed follows for domain block',
      actorId,
      domain,
      severedCount
    })
  }

  if (batches === MAX_SEVER_BATCHES) {
    const leftover = await database.getAcceptedOrRequestedFollowsWithDomain({
      actorId,
      domain,
      limit: 1
    })
    if (leftover.length > 0) {
      logger.warn({
        message:
          'Domain block severing hit its batch cap; follows with the domain remain',
        actorId,
        domain,
        severedCount
      })
    }
  }

  return block
}
