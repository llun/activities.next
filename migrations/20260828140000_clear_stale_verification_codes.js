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
 * THIS MIGRATION IS A TIDY-UP, NOT THE MECHANISM. The cohort is grandfathered by
 * `isAccountConfirmationPending`, which reads `emailVerified` alongside
 * `verificationCode` and so never holds a backfilled account pending in the
 * first place. That is exact and needs no notion of when anything ran. What is
 * left here is bringing the two columns into agreement, because there IS still a
 * reader of the raw column: `app/api/v1/emails/confirmations/route.ts` gates on
 * `account.verificationCode` directly, so until the row is tidied it keeps
 * offering a resend to an account the guards already treat as confirmed.
 *
 * So the bound below decides only whether a stale row is tidied, never whether
 * anyone keeps access. It stays conservative anyway, because clearing a code
 * that IS live destroys a confirmation link sitting in someone's inbox, and that
 * is not undoable.
 *
 * ONE condition, the clock: skip unless the backfill demonstrably ran long
 * enough ago that people have been relying on it. knex stamps `migration_time`
 * as each migration completes, so a backfill that ran in this same pass is
 * seconds old and a genuinely old one is months old. An unreadable or absent
 * stamp skips too — the whole point is to act only on proof.
 *
 * THREE earlier revisions got this wrong; they are recorded so a fourth is not
 * attempted.
 *
 *   1. `createdAt` against this file's own SIBLING FILENAME timestamp — the
 *      instant `migrate:make` ran on the author's machine, which no deployment
 *      coincides with. It skipped every account registered in an operator's
 *      deploy gap.
 *   2. `backfill.batch === max(batch)`, read as "the backfill ran in this pass".
 *      It is ALSO true whenever this migration is merely first in a new pass,
 *      because knex writes a migration's ledger row only after its own `up`
 *      resolves — so it skipped every instance that had caught up in one earlier
 *      pass, which is the common case.
 *   3. Both together. Since each `return`s, the skip set is their UNION, so the
 *      clock could only ever ADD skips and never rescue one the batch test took
 *      — leaving (2)'s false positive fully intact. The batch test is gone
 *      rather than reordered: for a real same-pass run the stamp is seconds old,
 *      so the clock already covers everything the batch test covered.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const BACKFILL = '20260320072514_better_auth_columns.js'

  // Unreachable through the knex migrator, which calls `ensureTable` before
  // running anything — a schema-dump-built database gets an EMPTY ledger, and
  // it is the `!backfill` guard below that catches that. Kept because this
  // reads the ledger as ordinary data, so it must not throw if some other
  // caller ever runs it without one.
  if (!(await knex.schema.hasTable('knex_migrations'))) return

  const backfill = await knex('knex_migrations').where('name', BACKFILL).first()
  if (!backfill) return

  // A day is far longer than any single migrate pass and far shorter than the
  // months this repair is aimed at, so it separates them without either needing
  // to be measured precisely.
  const RECENTLY_MS = 24 * 60 * 60 * 1000
  const ranAt = backfill.migration_time
    ? new Date(backfill.migration_time).getTime()
    : Number.NaN
  if (Number.isNaN(ranAt)) return
  if (Date.now() - ranAt < RECENTLY_MS) return

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
