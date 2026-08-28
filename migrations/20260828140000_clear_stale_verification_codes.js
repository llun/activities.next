/**
 * Clears the confirmation code on accounts that are already marked
 * e-mail-verified, so the two columns stop disagreeing.
 *
 * `20260320072514_better_auth_columns` populated the new `emailVerified` column
 * with `whereNotNull('verifiedAt').update({ emailVerified: true })`. That looked
 * like "verified accounts become verified", but `accounts.verifiedAt` carries
 * `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`), so
 * it was non-null for EVERY row — pending registrations included. The backfill
 * therefore declared every account of that era verified, and better-auth's
 * `emailAndPassword.requireEmailVerification` (which reads `emailVerified`) has
 * been letting those accounts sign in ever since.
 *
 * Those same rows kept a non-empty `verificationCode`, which is now the signal
 * the auth guards refuse on. Without this, an account in that cohort — signing
 * in normally for months — would abruptly lose both its session and its tokens,
 * with no way back: the resend-confirmation endpoint needs a credential, and the
 * credential is exactly what is refused.
 *
 * This grants nothing new. It aligns `verificationCode` with the
 * `emailVerified` that has governed sign-in for these accounts since March.
 *
 * `createdAt` is what bounds it, and the bound is load-bearing rather than
 * belt-and-braces. `emailVerified = false` is NOT sufficient on its own: knex
 * applies pending migrations in timestamp order within a single `yarn migrate`,
 * so on a database that predates `20260320072514` — an operator catching up
 * after a gap, a restore from a pre-March dump, a staging copy — that backfill
 * and this migration run in the SAME pass. The backfill would set
 * `emailVerified = true` on a registration made minutes earlier (its
 * `verifiedAt` being non-null by the column default), and this migration would
 * then destroy a confirmation code that is genuinely live: the account is
 * silently marked confirmed without anyone proving the address, and the link
 * already in the user's inbox is dead forever, because `verifyAccount` matches
 * on a code that no longer exists.
 *
 * Restricting to rows created before that backfill was authored keeps this to
 * the cohort it describes. A pending registration newer than the cutoff keeps
 * its code and stays gated on such an instance, which is the correct answer for
 * it.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  // The timestamp of `20260320072514_better_auth_columns`, whose backfill is
  // the only thing that can have produced `emailVerified = true` alongside a
  // live code. An account created after it reached `emailVerified` through
  // `createAccount` or `verifyAccount`, both of which are correct.
  const BACKFILL_RAN_AT = new Date('2026-03-20T07:25:14Z')

  // A literal `true` is safe on both backends: knex binds it per driver, and
  // the column only ever holds a real boolean (PostgreSQL) or 0/1 (SQLite).
  // `whereNot('verificationCode', '')` does not match NULL — SQL three-valued
  // logic — so `whereNotNull` is what keeps a null-code row out of the match
  // rather than being redundant with it.
  await knex('accounts')
    .where('emailVerified', true)
    .where('createdAt', '<', BACKFILL_RAN_AT)
    .whereNotNull('verificationCode')
    .whereNot('verificationCode', '')
    .update({ verificationCode: '' })
}

/**
 * Irreversible by design: the codes are destroyed, not moved, and reissuing
 * them would mail confirmation links to accounts that never asked for one.
 * A no-op down keeps `migrate:rollback` working for the migrations around it.
 *
 * @returns { Promise<void> }
 */
export const down = async function () {}
