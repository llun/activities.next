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

export { isAccountConfirmationPending }

export const canCreateSessionForAccount = (
  account: SessionAccountState
): boolean =>
  !isAccountConfirmationPending(account) &&
  Boolean(account.verifiedAt) &&
  !account.disabledAt &&
  Boolean(account.approvedAt)
