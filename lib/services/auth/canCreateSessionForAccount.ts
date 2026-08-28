// The gate applied when better-auth is about to create a session (sign-in). An
// account may sign in only when its e-mail confirmation is done, it is not
// disabled by a moderator, and it is approved for registration. `approvedAt` is
// set for every account at creation while no approval-required registration
// mode exists, so the approval check is a no-op today — but the machinery is
// wired and tested so enabling such a mode needs no auth-flow change.
type SessionAccountState = {
  verificationCode?: string | null
  verifiedAt?: number | null
  disabledAt?: number | null
  approvedAt?: number | null
}

/**
 * The registration's confirmation e-mail has been sent and not yet clicked.
 *
 * Read from `verificationCode`, not from `verifiedAt`: `accounts.verifiedAt`
 * carries `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`),
 * so `createAccount` could not leave it unset by omitting it — the database
 * filled it in with `now()` and every account ever written looked verified.
 * That is why the `verifiedAt` test below has never actually fired for a
 * pending registration. `createAccount` now writes an explicit null, which
 * makes `verifiedAt` accurate for anything created from here on, but rows
 * written before that still carry the default, so `verificationCode` is the
 * only signal that covers both. It is set once at registration and cleared to
 * `''` by `verifyAccount`; an instance with no e-mail configured never sets it
 * at all.
 */
export const isAccountConfirmationPending = (
  // Deliberately narrower than `SessionAccountState`: this reads one column, so
  // it asks for one column. That lets a caller holding a raw SQL row — where
  // the timestamps are `Date`, not epoch ms — use it without a cast.
  // `serializeAdminAccounts` is that caller.
  account: { verificationCode?: string | null }
): boolean => Boolean(account.verificationCode)

export const canCreateSessionForAccount = (
  account: SessionAccountState
): boolean =>
  !isAccountConfirmationPending(account) &&
  Boolean(account.verifiedAt) &&
  !account.disabledAt &&
  Boolean(account.approvedAt)
