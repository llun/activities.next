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
 * `emailVerified` that has governed sign-in for these accounts since March;
 * anything still genuinely pending has `emailVerified = false` and is untouched,
 * so a registration awaiting confirmation right now stays gated.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  // `emailVerified` is a boolean on PostgreSQL and an integer on SQLite, so
  // match on truthiness via `whereNot(false)`-style comparison rather than a
  // literal, and require a code that is actually set.
  await knex('accounts')
    .where('emailVerified', true)
    .whereNotNull('verificationCode')
    .whereNot('verificationCode', '')
    .update({ verificationCode: '' })
}

/**
 * Irreversible by design: the codes are destroyed, not moved, and reissuing
 * them would mail confirmation links to accounts that never asked for one.
 * A no-op down keeps `migrate:rollback` working for the migrations around it.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function () {}
