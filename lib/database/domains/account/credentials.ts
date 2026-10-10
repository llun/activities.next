// E-mail change, password reset and password change for an account.
import {
  CREDENTIAL_PROVIDER,
  getAccountFromId,
  selectAccount
} from '@/lib/database/domains/account/accounts'
import { deleteSessionsWithTokenDetach } from '@/lib/database/domains/account/sessions'
import type {
  ChangePasswordParams,
  RepointUnconfirmedAccountEmailParams,
  RequestEmailChangeParams,
  RequestPasswordResetParams,
  ResetPasswordWithCodeParams,
  ValidatePasswordResetCodeParams,
  VerifyEmailChangeParams
} from '@/lib/database/domains/account/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import type { Account } from '@/lib/types/domain/account'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

// How long a freshly issued password reset code stays valid.
const PASSWORD_RESET_CODE_TTL_MS = 24 * 60 * 60 * 1000
// How long an e-mail change code stays valid.
const EMAIL_CHANGE_CODE_TTL_MS = 24 * 60 * 60 * 1000

// Writes the credential provider row for a new password, or moves an existing
// one to it.
const upsertCredentialProvider = (
  db: Db,
  accountId: string,
  passwordHash: string,
  currentTime: Date
) =>
  db
    .insertInto('account_providers')
    .values({
      id: `credential_${accountId}`,
      accountId,
      provider: CREDENTIAL_PROVIDER,
      providerId: accountId,
      password: passwordHash,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((conflict) =>
      conflict
        .column('id')
        .doUpdateSet({ password: passwordHash, updatedAt: currentTime })
    )
    .execute()

// Note: Multiple email change requests will overwrite previous pending changes.
// The most recent request invalidates any previous verification codes.
export const requestEmailChange = async (
  db: Db,
  { accountId, newEmail, emailChangeCode }: RequestEmailChangeParams
): Promise<void> => {
  const currentTime = new Date()
  await db
    .updateTable('accounts')
    .set({
      emailChangePending: normalizeEmail(newEmail),
      emailChangeCode,
      emailChangeCodeExpiresAt: new Date(
        currentTime.getTime() + EMAIL_CHANGE_CODE_TTL_MS
      ),
      updatedAt: currentTime
    })
    .where('id', '=', accountId)
    .execute()
}

export const verifyEmailChange = async (
  db: Db,
  { accountId, emailChangeCode }: VerifyEmailChangeParams
): Promise<Account | null> => {
  // If accountId is provided, verify for that specific account
  // Otherwise, find the account by the verification code
  const account = await (
    accountId
      ? selectAccount(db).where('id', '=', accountId)
      : selectAccount(db).where('emailChangeCode', '=', emailChangeCode)
  )
    .limit(1)
    .executeTakeFirst()

  if (!account) return null
  if (account.emailChangeCode !== emailChangeCode) return null

  const now = new Date()
  if (
    account.emailChangeCodeExpiresAt != null &&
    now.getTime() > account.emailChangeCodeExpiresAt
  ) {
    return null
  }

  // Validate that emailChangePending is not null before proceeding
  const pendingEmail = account.emailChangePending
  if (pendingEmail == null) return null

  // `emailChangePending` is stored already-normalized; normalize again when
  // promoting it so the canonical `email` column can never drift.
  const normalizedEmail = normalizeEmail(pendingEmail)

  // The pending address may have been claimed by another account between the
  // change request and this verification. Reject gracefully — callers map a
  // null result to an "invalid or expired" response — instead of letting the
  // unique-email constraint surface as a 500.
  const conflicting = await db
    .selectFrom('accounts')
    .select('id')
    .where('email', '=', normalizedEmail)
    .where('id', '!=', account.id)
    .limit(1)
    .executeTakeFirst()
  if (conflicting) return null

  try {
    await db
      .updateTable('accounts')
      .set({
        email: normalizedEmail,
        emailVerifiedAt: now,
        emailChangePending: null,
        emailChangeCode: null,
        emailChangeCodeExpiresAt: null,
        updatedAt: now
      })
      .where('id', '=', account.id)
      .execute()
  } catch (error) {
    // Pre-check covers the common case; a concurrent claim can still race onto
    // the unique constraint between the check and the update. Map that to the
    // same graceful null rather than a 500.
    if (isUniqueConstraintError(error)) return null
    throw error
  }

  return getAccountFromId(db, { id: account.id })
}

// Multiple reset requests are allowed; the most recent code replaces prior ones.
export const requestPasswordReset = async (
  db: Db,
  {
    email,
    passwordResetCode,
    expiresAt,
    cooldownMs
  }: RequestPasswordResetParams
): Promise<boolean> => {
  const account = await db
    .selectFrom('accounts')
    .select('id')
    .where('email', '=', normalizeEmail(email))
    .limit(1)
    .executeTakeFirst()
  if (!account) return false

  const currentTime = new Date()
  const expiresAtDate =
    passwordResetCode === null
      ? null
      : expiresAt
        ? new Date(expiresAt)
        : new Date(currentTime.getTime() + PASSWORD_RESET_CODE_TTL_MS)

  const result = await db
    .updateTable('accounts')
    .set({
      passwordResetCode,
      passwordResetCodeExpiresAt: expiresAtDate,
      updatedAt: currentTime
    })
    .where('id', '=', account.id)
    .$if(cooldownMs !== undefined, (query) =>
      // A fresh code expires PASSWORD_RESET_CODE_TTL_MS after it is issued, so
      // "issued at least cooldownMs ago" is "expires no later than
      // now + TTL - cooldownMs". No outstanding code always qualifies.
      query.where((eb) =>
        eb.or([
          eb('passwordResetCode', 'is', null),
          eb('passwordResetCodeExpiresAt', 'is', null),
          eb(
            'passwordResetCodeExpiresAt',
            '<=',
            timestampValue(
              currentTime.getTime() +
                PASSWORD_RESET_CODE_TTL_MS -
                (cooldownMs ?? 0)
            )
          )
        ])
      )
    )
    .executeTakeFirst()

  return Number(result.numUpdatedRows) === 1
}

export const validatePasswordResetCode = async (
  db: Db,
  { passwordResetCode }: ValidatePasswordResetCodeParams
): Promise<string | null> => {
  const account = await db
    .selectFrom('accounts')
    .select('id')
    .where('passwordResetCode', '=', passwordResetCode)
    .where('passwordResetCodeExpiresAt', '>=', timestampValue(new Date()))
    .limit(1)
    .executeTakeFirst()
  return account?.id ?? null
}

export const resetPasswordWithCode = async (
  db: Db,
  { accountId, passwordResetCode, newPasswordHash }: ResetPasswordWithCodeParams
): Promise<Account | null> => {
  const now = new Date()
  const targetAccountId =
    accountId ||
    (
      await db
        .selectFrom('accounts')
        .select('id')
        .where('passwordResetCode', '=', passwordResetCode)
        .limit(1)
        .executeTakeFirst()
    )?.id
  if (!targetAccountId) return null

  // The code is consumed, the credential row moves to the new password and
  // every session of the account is revoked together or not at all.
  const updatedAccountId = await inTransaction(db, async (trx) => {
    const result = await trx
      .updateTable('accounts')
      .set({
        passwordHash: newPasswordHash,
        passwordResetCode: null,
        passwordResetCodeExpiresAt: null,
        updatedAt: now
      })
      .where('id', '=', targetAccountId)
      .where('passwordResetCode', '=', passwordResetCode)
      .where('passwordResetCodeExpiresAt', '>=', timestampValue(now))
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) return null

    await upsertCredentialProvider(trx, targetAccountId, newPasswordHash, now)
    await deleteSessionsWithTokenDetach(trx, (eb) =>
      eb('accountId', '=', targetAccountId)
    )
    return targetAccountId
  })

  if (!updatedAccountId) return null
  return getAccountFromId(db, { id: updatedAccountId })
}

export const changePassword = async (
  db: Db,
  { accountId, newPasswordHash }: ChangePasswordParams
): Promise<void> => {
  const currentTime = new Date()
  // The new hash, the credential row and the session wipe commit together.
  await inTransaction(db, async (trx) => {
    await trx
      .updateTable('accounts')
      .set({
        passwordHash: newPasswordHash,
        passwordResetCode: null,
        passwordResetCodeExpiresAt: null,
        updatedAt: currentTime
      })
      .where('id', '=', accountId)
      .execute()
    await upsertCredentialProvider(trx, accountId, newPasswordHash, currentTime)
    await deleteSessionsWithTokenDetach(trx, (eb) =>
      eb('accountId', '=', accountId)
    )
  })
}

export const repointUnconfirmedAccountEmail = async (
  db: Db,
  { accountId, email, verificationCode }: RepointUnconfirmedAccountEmailParams
): Promise<Account | null> => {
  const currentTime = new Date()

  // The state change is a predicate on the UPDATE statement rather than a
  // decision taken from a read in front of it. Only an account that is
  // genuinely awaiting confirmation (`verificationCode` set, not marked
  // `emailVerified`) may move to a new address.
  await db
    .updateTable('accounts')
    .set({
      email: normalizeEmail(email),
      // Written in the SAME statement as the address they belong to — see
      // `RepointUnconfirmedAccountEmailParams` for why all four move
      // together, and for what this query must not be used for.
      verificationCode,
      // Local nuance not in that type doc: `verifyAccount` restores
      // `verifiedAt`, `emailVerified`, and `emailVerifiedAt` when the new
      // address is confirmed, so an account that re-points an unconfirmed
      // address recovers every verification proof — including the `/account`
      // "Verified" badge — upon confirmation.
      emailVerified: false,
      verifiedAt: null,
      emailVerifiedAt: null,
      updatedAt: currentTime
    })
    .where('id', '=', accountId)
    .where('verificationCode', 'is not', null)
    .where('verificationCode', '!=', '')
    .where((eb) =>
      eb.or([eb('emailVerified', '=', false), eb('emailVerified', 'is', null)])
    )
    .execute()

  // Deliberately not keyed on the affected-row count: zero rows means either
  // "no longer pending" (already confirmed) or "no such account". The
  // re-read tells them apart so the caller can distinguish 403 from 404.
  return getAccountFromId(db, { id: accountId })
}
