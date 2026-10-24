import { recordActorIfNeeded } from '@/lib/actions/utils'
import { follow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

export type FollowActorResult =
  | { type: 'forbidden' }
  | { type: 'not-found' }
  | { type: 'ok'; targetActorId: string }

/**
 * The follow flow behind POST /api/v1/accounts/:id/follow, shared with the
 * bulk import: follow (and federate a Follow) or, when the actor already
 * follows the target, only update the given preferences.
 */
export const followActor = async ({
  database,
  currentActor,
  requestedActorId,
  reblogs,
  notify,
  languages
}: {
  database: Database
  currentActor: Actor
  requestedActorId: string
  reblogs?: boolean
  notify?: boolean
  languages?: string[]
}): Promise<FollowActorResult> => {
  if (!(await canFederateWithDomain(database, requestedActorId))) {
    return { type: 'forbidden' }
  }

  // Updating preferences on an account the actor already follows is a purely
  // local operation, so resolve the existing follow before any network call.
  // This lets clients change reblogs/notify/languages even when the remote
  // actor is temporarily unreachable.
  let targetActorId = requestedActorId
  let existingFollow = await database.getAcceptedOrRequestedFollow({
    actorId: currentActor.id,
    targetActorId
  })

  let signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>
  if (!existingFollow) {
    // New follow: the target must be recorded before a follow row points
    // at it. recordActorIfNeeded refuses documents it will not store (an
    // id on another origin, an unreachable actor), and it keys the row on
    // the id the actor's origin names, which an alias URL is not.
    signingActor = await getFederationSigningActor(database)
    const targetActor = await recordActorIfNeeded({
      actorId: requestedActorId,
      database,
      signingActor
    })
    if (!targetActor) return { type: 'not-found' }
    if (targetActor.id !== requestedActorId) {
      targetActorId = targetActor.id
      existingFollow = await database.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId
      })
    }
  }

  if (existingFollow) {
    if (
      reblogs !== undefined ||
      notify !== undefined ||
      languages !== undefined
    ) {
      await database.updateFollowPreferences({
        actorId: currentActor.id,
        targetActorId,
        reblogs,
        notify,
        languages
      })
    }
  } else {
    const followItem = await database.createFollow({
      actorId: currentActor.id,
      targetActorId,
      status: FollowStatus.enum.Requested,
      inbox: `${currentActor.id}/inbox`,
      sharedInbox: `https://${currentActor.domain}/inbox`,
      reblogs,
      notify,
      languages
    })
    await follow(followItem.id, currentActor, targetActorId, signingActor)
  }

  return { type: 'ok', targetActorId }
}
