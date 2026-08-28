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
 * THIS MIGRATION IS A TIDY-UP, NOT THE MECHANISM. The cohort is grandfathered
 * by `isAccountConfirmationPending`, which reads `emailVerified` alongside
 * `verificationCode` and so never holds a backfilled account pending in the
 * first place. That is exact and needs no notion of when anything ran. What is
 * left here is bringing the two columns into agreement, so a reader of the row
 * is not misled by a code that no longer gates anything.
 *
 * Because of that, the bound below no longer decides whether anyone keeps
 * access — it only decides whether a stale row gets tidied. It is still
 * deliberately conservative, because clearing a code that IS live destroys a
 * confirmation link sitting in someone's inbox, and that is not undoable.
 *
 * Two conditions skip, and they cover the same hazard by different routes:
 *
 *   - The backfill shares this pass's batch. knex applies pending migrations in
 *     one `yarn migrate`, so on a database predating it the backfill runs
 *     moments before this one and its `emailVerified` proves nothing.
 *   - The backfill ran recently by the clock. `batch` identifies an INVOCATION,
 *     not an upgrade: a catch-up run that is interrupted and resumed puts the
 *     backfill in one batch and this migration in the next, and the batch test
 *     alone then fails to fire. The clock does not care how the run was split.
 *
 * Two earlier revisions tried to bound this by time alone and both were wrong.
 * One compared `createdAt` against this file's own SIBLING FILENAME timestamp —
 * the instant `migrate:make` ran on the author's machine, which no deployment
 * coincides with — and skipped every account registered in an operator's deploy
 * gap. The next used `batch` alone, which reads as "same pass" but is also true
 * whenever this migration is simply FIRST in a new pass, because knex writes a
 * migration's ledger row only after its own `up` resolves — so it skipped every
 * instance that had caught up in one earlier pass, which is the common case.
 * Neither would matter now; both are recorded so a third attempt is not made.
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
  // NOTE this is also true when this migration is merely FIRST in a new pass,
  // which is why the clock check below is not redundant with it.
  const latest = await knex('knex_migrations').max('batch as batch').first()
  if (latest && backfill.batch === latest.batch) return

  // A day is far longer than any single migrate pass and far shorter than the
  // months this repair is actually aimed at, so it separates them without
  // needing either to be measured precisely.
  const RECENTLY_MS = 24 * 60 * 60 * 1000
  const ranAt = backfill.migration_time
    ? new Date(backfill.migration_time).getTime()
    : null
  if (
    ranAt !== null &&
    !Number.isNaN(ranAt) &&
    Date.now() - ranAt < RECENTLY_MS
  )
    return

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
