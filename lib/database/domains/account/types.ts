// Parameter and result types of the account domain (accounts, their sessions,
// actors minted for them, e-mail change and password reset).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Account } from '@/lib/types/domain/account'
import type { Actor } from '@/lib/types/domain/actor'
import type { Session } from '@/lib/types/domain/session'

export type IsAccountExistsParams = { email: string }
export type IsUsernameExistsParams = { username: string; domain: string }
export type CreateAccountParams = {
  email: string
  username: string
  name?: string | null
  passwordHash: string
  verificationCode?: string | null
  domain: string
  privateKey: string
  publicKey: string
}
export type GetAccountFromIdParams = { id: string }
export type GetAccountFromEmailParams = { email: string }
export type LinkAccountWithProviderParams = {
  accountId: string
  provider: string
  providerAccountId: string
}
export type VerifyAccountParams = {
  verificationCode: string
}
export type CreateAccountSessionParams = {
  accountId: string
  token: string
  expireAt: number
  actorId?: string | null
}
export type GetAccountAllSessionsParams = {
  accountId: string
}
export type DeleteAccountSessionByIdParams = {
  // Only a session this account owns is deleted; anything else matches nothing.
  accountId: string
  id: string
}
export type DeleteOtherAccountSessionsParams = {
  accountId: string
  // The session to keep (the device making the request). Every other session
  // for the account is revoked.
  exceptToken: string
}

export type UnlinkAccountFromProviderParams = {
  accountId: string
  provider: string
}

export type CreateActorForAccountParams = {
  accountId: string
  username: string
  domain: string
  privateKey: string
  publicKey: string
}
export type GetActorsForAccountParams = { accountId: string }
export type SetDefaultActorParams = { accountId: string; actorId: string }

export type RequestEmailChangeParams = {
  accountId: string
  newEmail: string
  emailChangeCode: string
}
export type VerifyEmailChangeParams = {
  accountId?: string
  emailChangeCode: string
}
export type RequestPasswordResetParams = {
  email: string
  passwordResetCode: string | null
  expiresAt?: number | null
  // When set, the code is written only if the account has no live code issued
  // within this many milliseconds; otherwise nothing is written and the call
  // returns false. The check is a predicate on the UPDATE, so concurrent
  // requests cannot each slip past it.
  cooldownMs?: number
}
export type ValidatePasswordResetCodeParams = {
  passwordResetCode: string
}
export type ResetPasswordWithCodeParams = {
  accountId?: string
  passwordResetCode: string
  newPasswordHash: string
}
export type ChangePasswordParams = {
  accountId: string
  newPasswordHash: string
}
export type RepointUnconfirmedAccountEmailParams = {
  accountId: string
  email: string
  // A freshly minted code for the NEW address.
  //
  // This method is for one job — moving an account that is still awaiting
  // confirmation onto a different address — and it is named for that job
  // because the write is only correct there. It replaces every proof the
  // account had about its OLD address: the code, `emailVerified`, `verifiedAt`
  // and `emailVerifiedAt` all move together, because each of them proves
  // control of the address it was set for and none may outlive it.
  //
  // The UPDATE is predicated on the account still being pending
  // (`verificationCode` non-empty and not marked `emailVerified`), so an
  // account confirmed concurrently is not re-pointed. The re-read account is
  // returned so the caller can distinguish "no such account" (null) from
  // "no longer pending" (isAccountConfirmationPending false).
  //
  // So do NOT reach for this to change a CONFIRMED account's address. It would
  // strip that account's verification and leave it unable to sign in
  // (`requireEmailVerification` reads `emailVerified`) and unable to resend
  // (`POST /api/v1/emails/confirmations` requires an outstanding code) — an
  // unrecoverable state that nothing flags, because
  // `isAccountConfirmationPending` reads a code that is no longer set. The
  // confirmed-user flow is `requestEmailChange`/`verifyEmailChange`, which
  // proves the new address before moving anything.
  verificationCode: string
}
export type UpdateAccountNameParams = {
  accountId: string
  name: string | null
}
export type UpdateAccountImageParams = {
  accountId: string
  iconUrl: string | null
}

export interface AccountDatabase {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | null>
  getAccountFromEmail(
    params: GetAccountFromEmailParams
  ): Promise<Account | null>
  verifyAccount(params: VerifyAccountParams): Promise<Account | null>

  createAccountSession(params: CreateAccountSessionParams): Promise<void>
  getAccountAllSessions(params: GetAccountAllSessionsParams): Promise<Session[]>
  // Deletes the session with this row id when it belongs to `accountId`, and
  // returns how many rows were deleted (0 for an unknown or foreign id).
  deleteAccountSessionById(
    params: DeleteAccountSessionByIdParams
  ): Promise<number>
  // Revoke every session for the account except `exceptToken`. Returns the
  // number of sessions revoked.
  deleteOtherAccountSessions(
    params: DeleteOtherAccountSessionsParams
  ): Promise<number>

  unlinkAccountFromProvider(
    params: UnlinkAccountFromProviderParams
  ): Promise<void>

  createActorForAccount(params: CreateActorForAccountParams): Promise<string>
  getActorsForAccount(params: GetActorsForAccountParams): Promise<Actor[]>
  setDefaultActor(params: SetDefaultActorParams): Promise<void>

  requestEmailChange(params: RequestEmailChangeParams): Promise<void>
  verifyEmailChange(params: VerifyEmailChangeParams): Promise<Account | null>
  requestPasswordReset(params: RequestPasswordResetParams): Promise<boolean>
  validatePasswordResetCode(
    params: ValidatePasswordResetCodeParams
  ): Promise<string | null>
  resetPasswordWithCode(
    params: ResetPasswordWithCodeParams
  ): Promise<Account | null>
  changePassword(params: ChangePasswordParams): Promise<void>
  repointUnconfirmedAccountEmail(
    params: RepointUnconfirmedAccountEmailParams
  ): Promise<Account | null>
  updateAccountName(params: UpdateAccountNameParams): Promise<void>
  updateAccountImage(params: UpdateAccountImageParams): Promise<void>
}
