import { Actor } from '@/lib/types/domain/actor'

/**
 * Whether an actor can represent its account right now: not pending deletion
 * and not suspended.
 *
 * A suspended actor is refused by every guarded surface, so choosing one by
 * default would hand the session an identity that cannot act — while another
 * actor on the same account still could. Every place that picks an actor for an
 * account (the web session, OAuth token issuance, the consent and actor
 * pickers) uses this rule so they cannot disagree.
 */
export const isUsableAccountActor = (actor: Actor): boolean =>
  !actor.deletionStatus && !actor.suspendedAt

/**
 * Picks the actor that represents an account when nothing else has selected
 * one.
 *
 * `accounts.defaultActorId` is only written when a user explicitly picks a
 * default actor, so most accounts never have one — but they still own actors.
 * Falling back to the first actor that is not pending deletion is what the web
 * session has always done; sharing that rule with OAuth token issuance keeps
 * both surfaces on the same actor instead of leaving a grant actor-less.
 *
 * A usable actor (neither deleting nor suspended) is preferred over the
 * configured default, because a suspended default would otherwise be selected
 * for an account that still has a usable actor. The old choice is kept only as
 * a fallback when NOTHING is usable, so an all-suspended account still resolves
 * an actor and every guarded route answers 403 rather than the session silently
 * losing its identity.
 */
export const selectAccountActor = (
  actors: Actor[],
  defaultActorId?: string | null
): Actor | null => {
  const usable = actors.filter(isUsableAccountActor)
  if (defaultActorId) {
    const defaultActor = usable.find((actor) => actor.id === defaultActorId)
    if (defaultActor) return defaultActor
  }
  if (usable.length > 0) return usable[0]

  if (defaultActorId) {
    const defaultActor = actors.find(
      (actor) => actor.id === defaultActorId && !actor.deletionStatus
    )
    if (defaultActor) return defaultActor
  }

  return actors.find((actor) => !actor.deletionStatus) ?? null
}
