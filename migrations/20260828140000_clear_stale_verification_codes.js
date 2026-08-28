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
 * What bounds it is WHEN THE BACKFILL ACTUALLY RAN on this database, read from
 * `knex_migrations`, not any timestamp baked in here. Two hazards pull in
 * opposite directions and only that reading separates them.
 *
 * If the backfill runs in the SAME pass as this migration — a database that
 * predates it: a restore from a pre-March dump, a staging copy, an operator
 * catching up — then knex applies both in one `yarn migrate`, and the backfill
 * marks a registration made minutes earlier as verified on the strength of the
 * column default. Clearing then would destroy a code that is genuinely live:
 * the account silently confirmed with nobody proving the address, and the link
 * already in the user's inbox dead forever. So this skips entirely there — and
 * nothing is lost by skipping, because on such a database `emailVerified` was
 * only just populated, so nobody has been relying on it to sign in.
 *
 * If the backfill ran in an EARLIER pass, everything it marked has been signing
 * in ever since, and clearing preserves exactly that access.
 *
 * An earlier revision compared `createdAt` against this migration's sibling
 * FILENAME timestamp. That is the instant `migrate:make` ran on the author's
 * machine, which no deployment ever coincides with — that migration was merged
 * eleven hours later — so every account registered inside an operator's deploy
 * gap was missed and locked out, which is the failure this whole file exists to
 * prevent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const BACKFILL = '20260320072514_better_auth_columns.js'

  // A database built straight from the schema dump has no migration ledger and
  // no accounts to repair, so there is nothing to do and nothing to infer.
  if (!(await knex.schema.hasTable('knex_migrations'))) return

  const backfill = await knex('knex_migrations').where('name', BACKFILL).first()
  if (!backfill) return

  // knex writes a migration's ledger row as it completes, so a backfill that
  // ran earlier in THIS pass already carries the batch this pass is using.
  const latest = await knex('knex_migrations').max('batch as batch').first()
  if (latest && backfill.batch === latest.batch) return

  // A literal `true` is safe on both backends: knex binds it per driver, and
  // the column only ever holds a real boolean (PostgreSQL) or 0/1 (SQLite).
  // No `whereNotNull` is needed — `NULL = ''` is NULL and `NOT NULL` is NULL,
  // so three-valued logic already excludes a null code from the match.
  await knex('accounts')
    .where('emailVerified', true)
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
