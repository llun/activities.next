// Backfills existing account emails to their canonical lowercase form so the
// whole stack (storage, lookup, comparison) is case-insensitive. The backfill
// itself normalizes in JS with the same `trim().toLowerCase()` rule the runtime
// uses (see lib/utils/normalizeEmail.ts) so stored values can never disagree
// with runtime normalization (SQL `lower()` is ASCII-only on SQLite, while JS
// `toLowerCase` is Unicode-aware).
//
// `accounts.email` carries a UNIQUE constraint, so lowercasing could collide if
// two accounts already differ only by casing (e.g. `User@x.com` and
// `user@x.com`). That is a data problem an operator must resolve by hand —
// auto-merging accounts would be destructive — so this migration FAILS LOUDLY
// listing the colliding addresses instead of attempting a merge. The collision
// check is a single set-based SQL aggregate (`GROUP BY ... HAVING count > 1`),
// so it uses O(number-of-collisions) memory — effectively zero on the common
// case — rather than buffering every account in the Node process. Because SQL
// `lower()` is ASCII-only on SQLite, a non-ASCII casing pair could slip past
// that pre-check; the backfill UPDATE in Pass 2 then catches the resulting
// UNIQUE violation and re-raises it as the SAME friendly collision error (and
// rolls the whole transaction back), so operators get a clear message on every
// engine and data is never corrupted.
//
// The backfill reads rows in keyset-paginated chunks (ordered by id) so peak
// memory stays bounded, and runs inside a single transaction so it is atomic:
// either every row is normalized or none is, and re-running after a failure is
// safe.

const normalizeEmail = (email) => String(email).trim().toLowerCase()

const CHUNK_SIZE = 500

// Self-contained unique-constraint detection (the migration intentionally does
// not import app code). Mirrors lib/database/sql/utils/isUniqueConstraintError.
const isUniqueConstraintError = (error) => {
  if (typeof error !== 'object' || error === null) return false
  const { code, errno, message } = error
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errno === 1062 ||
    (typeof message === 'string' &&
      message.includes('UNIQUE constraint failed'))
  )
}

const collisionError = (details) =>
  new Error(
    'Cannot lowercase account emails: the following addresses collide once ' +
      'normalized to lowercase. Resolve these duplicate accounts manually ' +
      `before re-running the migration (accounts are NOT auto-merged):\n${details}`
  )

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
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    // Pass 1 — detect collisions before writing anything, with a set-based SQL
    // aggregate so memory does not scale with the number of accounts. Any
    // normalized email shared by more than one account would violate the unique
    // constraint once lowercased. `lower(trim(...))` mirrors the runtime
    // normalization for ASCII addresses (the realistic case); the transaction +
    // unique constraint cover the rest.
    const collisionGroups = await trx('accounts')
      .whereNotNull('email')
      .groupByRaw('lower(trim(email))')
      .havingRaw('count(*) > 1')
      .select(trx.raw('lower(trim(email)) as norm'))

    if (collisionGroups.length > 0) {
      // Collisions are exceptional, so only here do we fetch the offending
      // originals (just the colliding groups) to build a helpful message.
      const norms = collisionGroups.map((group) => group.norm)
      const placeholders = norms.map(() => '?').join(', ')
      const rows = await trx('accounts')
        .whereNotNull('email')
        .whereRaw(`lower(trim(email)) in (${placeholders})`, norms)
        .select('email')

      const byNormalized = new Map()
      for (const row of rows) {
        const normalized = normalizeEmail(row.email)
        const group = byNormalized.get(normalized) ?? []
        group.push(row.email)
        byNormalized.set(normalized, group)
      }

      const details = [...byNormalized.entries()]
        .map(
          ([normalized, originals]) =>
            `  ${normalized} <- [${originals.join(', ')}]`
        )
        .join('\n')
      throw collisionError(details)
    }

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
            try {
              await trx('accounts').where('id', account.id).update(update)
            } catch (error) {
              // The SQL pre-check uses the engine's `lower()`, which is
              // ASCII-only on SQLite, so a non-ASCII casing pair (e.g.
              // `CafÉ@x.com` vs `café@x.com`) can slip past it and only collide
              // here when the Unicode-aware JS normalization is applied. Convert
              // that raw UNIQUE violation into the same friendly collision error
              // (and roll back) rather than surfacing an opaque DB error.
              if (isUniqueConstraintError(error) && update.email) {
                throw collisionError(`  ${update.email} <- [${account.email}]`)
              }
              throw error
            }
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
export const down = async (_knex) => {
  // No-op: cannot restore original email casing.
}
