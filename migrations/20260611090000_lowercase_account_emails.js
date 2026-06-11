// Backfills existing account emails to their canonical lowercase form so the
// whole stack (storage, lookup, comparison) is case-insensitive. Normalization
// is done in JS with the same `trim().toLowerCase()` rule the runtime uses (see
// lib/utils/normalizeEmail.ts) rather than SQL `lower()`, so the backfill can
// never disagree with runtime normalization (SQL `lower()` is ASCII-only on
// SQLite, while JS `toLowerCase` is Unicode-aware).
//
// `accounts.email` carries a UNIQUE constraint, so lowercasing could collide if
// two accounts already differ only by casing (e.g. `User@x.com` and
// `user@x.com`). That is a data problem an operator must resolve by hand —
// auto-merging accounts would be destructive — so this migration FAILS LOUDLY
// listing the colliding addresses instead of attempting a merge.

const normalizeEmail = (email) => String(email).trim().toLowerCase()

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    const accounts = await trx('accounts').select(
      'id',
      'email',
      'emailChangePending'
    )

    // Detect collisions before writing anything: group accounts by their
    // normalized email and flag any normalized value claimed by more than one
    // account.
    const byNormalized = new Map()
    for (const account of accounts) {
      if (account.email == null) continue
      const normalized = normalizeEmail(account.email)
      const group = byNormalized.get(normalized) ?? []
      group.push(account.email)
      byNormalized.set(normalized, group)
    }

    const collisions = [...byNormalized.entries()].filter(
      ([, originals]) => originals.length > 1
    )

    if (collisions.length > 0) {
      const details = collisions
        .map(
          ([normalized, originals]) =>
            `  ${normalized} <- [${originals.join(', ')}]`
        )
        .join('\n')
      throw new Error(
        'Cannot lowercase account emails: the following addresses collide ' +
          'once normalized to lowercase. Resolve these duplicate accounts ' +
          'manually before re-running the migration (accounts are NOT ' +
          `auto-merged):\n${details}`
      )
    }

    // No collisions — rewrite the rows whose stored value is not already
    // canonical. Update `email` and the pending-change column independently so
    // both end up normalized.
    for (const account of accounts) {
      const update = {}

      if (account.email != null) {
        const normalizedEmail = normalizeEmail(account.email)
        if (normalizedEmail !== account.email) {
          update.email = normalizedEmail
        }
      }

      if (account.emailChangePending != null) {
        const normalizedPending = normalizeEmail(account.emailChangePending)
        if (normalizedPending !== account.emailChangePending) {
          update.emailChangePending = normalizedPending
        }
      }

      if (Object.keys(update).length > 0) {
        await trx('accounts').where('id', account.id).update(update)
      }
    }
  })
}

/**
 * Irreversible: the original (pre-normalization) casing is not retained, so the
 * rollback cannot restore it. Implemented as a no-op so rolling back later
 * migrations does not fail on this one.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async (_knex) => {
  // No-op: cannot restore original email casing.
}
