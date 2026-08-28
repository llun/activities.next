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

/**
 * The registration's confirmation e-mail has been sent and not yet clicked.
 *
 * Two columns, and both are needed. `verificationCode` says a code is
 * outstanding — set once at registration, cleared to `''` by `verifyAccount`,
 * never set at all on an instance with no e-mail configured. `emailVerified` is
 * better-auth's own column, and `emailAndPassword.requireEmailVerification` has
 * gated credential sign-in on it since 2026-03-20; reading it here is what keeps
 * this gate and that one answering the same question.
 *
 * The pair is required because of a data defect neither column reveals alone.
 * `20260320072514_better_auth_columns` populated `emailVerified` with
 * `whereNotNull('verifiedAt')`, and `accounts.verifiedAt` carries
 * `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`), so
 * that backfill matched EVERY row — pending registrations included — and those
 * accounts have been signing in ever since. Reading `verificationCode` alone
 * refuses exactly them, with no way back: the resend endpoint needs a
 * credential, and the credential is what is being refused.
 *
 * So an account better-auth already treats as verified is not held pending here
 * either. That grants nothing new — it is the gate that has actually been
 * governing those sign-ins — and unlike a repair keyed on when a migration ran,
 * it needs no timestamp, no ledger reading and no guess about an operator's
 * deploy schedule. Two attempts at that guess were wrong in opposite directions
 * before this replaced them as the mechanism.
 *
 * `verifiedAt` is deliberately NOT consulted here. It is the column the default
 * ruined; any check keyed on it reads as a working gate and fires for nobody.
 */
export const isAccountConfirmationPending = (
  // Deliberately narrower than `SessionAccountState`: this reads two columns,
  // so it asks for two. That lets a caller holding a raw SQL row — where the
  // timestamps are `Date` rather than epoch ms, and `emailVerified` is 0/1
  // rather than a boolean — pass it without a cast. `serializeAdminAccounts` is
  // that caller, which is why `emailVerified` is typed loosely enough to accept
  // SQLite's integer.
  account: {
    verificationCode?: string | null
    emailVerified?: boolean | number | null
  }
): boolean => Boolean(account.verificationCode) && !account.emailVerified

export const canCreateSessionForAccount = (
  account: SessionAccountState
): boolean =>
  !isAccountConfirmationPending(account) &&
  Boolean(account.verifiedAt) &&
  !account.disabledAt &&
  Boolean(account.approvedAt)
