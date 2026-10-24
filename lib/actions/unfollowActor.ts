import { unfollow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

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
    const canFederate = await canFederateWithDomain(database, targetActorId)
    const signingActor = canFederate
      ? await getFederationSigningActor(database)
      : undefined
    await Promise.all([
      canFederate
        ? unfollow(currentActor, existingFollow, signingActor)
        : undefined,
      database.updateFollowStatus({
        followId: existingFollow.id,
        status: FollowStatus.enum.Undo
      })
    ])
  }

  return true
}
