import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { FollowStatus } from '@/lib/types/domain/follow'
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

    // Federate an Undo Follow only for the caller's own outbound follows —
    // the ones the local blocking actor initiated, i.e. `follow.actorId ===
    // actorId`. Dropped followers (whose `follow.actorId` is the other actor on
    // the blocked domain) are severed locally without federation, matching
    // applyBlock. Comparing ids identifies the caller's follows directly, so we
    // avoid a per-follow `getActorFromId` lookup (an N+1 across up to
    // SEVER_BATCH_SIZE rows every batch).
    const followsToFederate = follows.filter(
      (follow) => follow.actorId === actorId
    )

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
