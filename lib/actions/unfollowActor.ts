import { unfollow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * The unfollow flow behind POST /api/v1/accounts/:id/unfollow, shared with the
 * bulk import. Returns false for an unknown target the actor does not follow
 * (the route answers 404).
 */
export const unfollowActor = async ({
  database,
  currentActor,
  targetActorId
}: {
  database: Database
  currentActor: Actor
  targetActorId: string
}): Promise<boolean> => {
  const existingFollow = await database.getAcceptedOrRequestedFollow({
    actorId: currentActor.id,
    targetActorId
  })

  // Unknown target: Mastodon 404s instead of answering with an all-false
  // Relationship. A target the actor follows always has a local row, so
  // the existence check only matters when there is no follow to undo
  // (mirrors the mute route's local getActorFromId check).
  if (!existingFollow) {
    const targetActor = await database.getActorFromId({ id: targetActorId })
    if (!targetActor) return false
  }

  if (existingFollow) {
    await undoFollow(database, currentActor, existingFollow)
  }

  return true
}

// Undoes the follow here and sends the Undo. When federation policy cannot be
// read right now, the follow is still undone here and the Undo goes to the
// queue, whose job rechecks policy and retries until it can be decided.
export const undoFollow = async (
  database: Database,
  currentActor: Actor,
  follow: Follow
) => {
  let canFederate: boolean | 'unknown'
  try {
    canFederate = await canFederateWithDomain(database, follow.targetActorId)
  } catch (error) {
    if (!(error instanceof FederationPolicyUnavailableError)) throw error
    canFederate = 'unknown'
  }

  if (canFederate === true) {
    const signingActor = await getFederationSigningActor(database)
    await Promise.all([
      unfollow(currentActor, follow, signingActor),
      database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })
    ])
    return
  }

  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Undo
  })
  if (canFederate === 'unknown') {
    try {
      await getQueue().publish({
        id: getHashFromString(`${follow.id}/undo`),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: { actorId: follow.actorId, follow }
      })
    } catch (error) {
      // The follow is undone here either way; under NoQueue the job runs
      // inline and its retryable error has nowhere to go.
      logger.warn({
        message:
          'Failed to queue an Undo Follow while federation policy is unavailable',
        followId: follow.id,
        err: toLoggableError(error)
      })
    }
  }
}
