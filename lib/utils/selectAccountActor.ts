import { Actor } from '@/lib/types/domain/actor'

/**
 * Picks the actor that represents an account when nothing else has selected
 * one.
 *
 * `accounts.defaultActorId` is only written when a user explicitly picks a
 * default actor, so most accounts never have one — but they still own actors.
 * Falling back to the first actor that is not pending deletion is what the web
 * session has always done; sharing that rule with OAuth token issuance keeps
 * both surfaces on the same actor instead of leaving a grant actor-less.
 */
export const selectAccountActor = (
  actors: Actor[],
  defaultActorId?: string | null
): Actor | null => {
  if (defaultActorId) {
    const defaultActor = actors.find(
      (actor) => actor.id === defaultActorId && !actor.deletionStatus
    )
    if (defaultActor) return defaultActor
  }

  return actors.find((actor) => !actor.deletionStatus) ?? null
}
