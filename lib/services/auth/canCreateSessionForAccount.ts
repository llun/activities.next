// The gate applied when better-auth is about to create a session (sign-in). An
// account may sign in only when it is email-verified, not disabled by a
// moderator, and approved for registration. `approvedAt` is set for every
// account at creation while no approval-required registration mode exists, so
// the approval check is a no-op today — but the machinery is wired and tested
// so enabling such a mode needs no auth-flow change.
type SessionAccountState = {
  verifiedAt?: number | null
  disabledAt?: number | null
  approvedAt?: number | null
}

export const canCreateSessionForAccount = (
  account: SessionAccountState
): boolean =>
  Boolean(account.verifiedAt) &&
  !account.disabledAt &&
  Boolean(account.approvedAt)
