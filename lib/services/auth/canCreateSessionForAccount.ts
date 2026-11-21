import { isAccountConfirmationPending } from '@/lib/services/guards/accountState'

// The gate applied when better-auth is about to create a session (sign-in). An
// account may sign in only when its e-mail confirmation is done, it is not
// disabled by a moderator, and it is approved for registration. `approvedAt` is
// set for every account at creation while no approval-required registration
// mode exists, so the approval check is a no-op today — but the machinery is
// wired and tested so enabling such a mode needs no auth-flow change.
type SessionAccountState = {
  verificationCode?: string | null
  emailVerified?: boolean | number | null
  verifiedAt?: number | null
  disabledAt?: number | null
  approvedAt?: number | null
}

// The one actor column this gate reads. Kept structural so the caller can pass
// the domain `Actor` without this module depending on it.
type SessionActorState = {
  suspendedAt?: number | null
}

export { isAccountConfirmationPending }

export const canCreateSessionForAccount = (
  account: SessionAccountState,
  actors?: SessionActorState[]
): boolean => {
  if (
    isAccountConfirmationPending(account) ||
    !account.verifiedAt ||
    account.disabledAt ||
    !account.approvedAt
  ) {
    return false
  }

  // An account whose every actor is suspended has nothing left to sign in as:
  // the session would be minted only for every guarded route to refuse it. A
  // suspended actor among others does not block sign-in — the account can still
  // act as the actors that are not suspended.
  if (
    actors &&
    actors.length > 0 &&
    actors.every((actor) => Boolean(actor.suspendedAt))
  ) {
    return false
  }

  return true
}
