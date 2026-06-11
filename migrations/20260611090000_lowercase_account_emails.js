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
//
// Rows are read in keyset-paginated chunks (ordered by id) rather than loaded
// all at once, to keep peak memory bounded on instances with many accounts.
// Writes happen inside a single transaction so the backfill is atomic: either
// every row is normalized or none is, and re-running after a failure is safe.

const normalizeEmail = (email) => String(email).trim().toLowerCase()

const CHUNK_SIZE = 500

// Iterates a table in id-ordered chunks, invoking `handle(rows)` per chunk.
// Keyset pagination (id > cursor) keeps each query bounded and avoids holding
// the whole table in memory at once.
const forEachChunk = async (trx, columns, handle) => {
  let cursor = null
  for (;;) {
    let query = trx('accounts')
      .select(columns)
      .orderBy('id', 'asc')
      .limit(CHUNK_SIZE)
    if (cursor !== null) query = query.where('id', '>', cursor)

    const rows = await query
    if (rows.length === 0) break

    await handle(rows)

    if (rows.length < CHUNK_SIZE) break
    cursor = rows[rows.length - 1].id
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    // Pass 1 — detect collisions before writing anything. Any normalized email
    // claimed by more than one account would violate the unique constraint once
    // lowercased. `seen` keeps just the first original per distinct normalized
    // value (one string per email); the (normally empty) `collisions` map only
    // grows when an actual duplicate is found, so memory stays minimal even on
    // instances with many accounts.
    const seen = new Map()
    const collisions = new Map()
    await forEachChunk(trx, ['id', 'email'], (rows) => {
      for (const account of rows) {
        if (account.email == null) continue
        const normalized = normalizeEmail(account.email)
        const firstSeen = seen.get(normalized)
        if (firstSeen === undefined) {
          seen.set(normalized, account.email)
          continue
        }
        const existing = collisions.get(normalized)
        if (existing) {
          existing.push(account.email)
        } else {
          collisions.set(normalized, [firstSeen, account.email])
        }
      }
    })

    if (collisions.size > 0) {
      const details = [...collisions.entries()]
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

    seen.clear()

    // Pass 2 — rewrite the rows whose stored value is not already canonical.
    // Update `email` and the pending-change column independently so both end up
    // normalized. Per-row updates (rather than a set-based `lower()` UPDATE) are
    // intentional: they apply the exact same JS normalization as the runtime,
    // which a SQL `lower()` cannot guarantee on SQLite. Only differing rows are
    // touched, and the read is chunked, so work is proportional to the number of
    // rows that actually need changing.
    await forEachChunk(
      trx,
      ['id', 'email', 'emailChangePending'],
      async (rows) => {
        for (const account of rows) {
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
      }
    )
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
