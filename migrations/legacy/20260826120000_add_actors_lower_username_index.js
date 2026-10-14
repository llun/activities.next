// Adds the index the case-insensitive half of an actor lookup reads.
//
// `findActorRowByUsername` resolves `(username, domain)` in two steps: an exact
// match, which `actors_username_domain_unique` already serves, and — only when
// that misses — a folded `lower(username) = ?`. Without this index the folded
// arm is a sequential scan of `actors`, and that arm runs on exactly the
// requests that are already the least bounded: an unknown handle (404 traffic,
// which is not rate-limited by anything here), the first lookup of a remote
// actor before it is persisted, and account search. `actors` grows with every
// remote account this instance has ever seen, not with its own user count, so
// the scan gets worse over time on a busy instance and never on a quiet one —
// the shape of regression that ships unnoticed.
//
// `lower(username)` and not `lower(username), lower(domain)`. The lookup leaves
// `domain` compared exactly (callers lowercase it themselves, and WebFinger
// carries its own domain fallback), so folding it in the index would put the
// index and the predicate out of step and cost the second column.
//
// Expressed as raw SQL because knex's schema builder has no functional-index
// form, and branched by dialect because the three backends do not agree on one:
//
//   - PostgreSQL and SQLite take the same statement verbatim. `lower()` is a
//     builtin on each, both accept double-quoted identifiers, and both accept
//     `IF NOT EXISTS` on `CREATE INDEX`.
//   - MySQL is deliberately SKIPPED, not translated. Its default collations
//     (`utf8mb4_0900_ai_ci` and friends) are already case-insensitive, so the
//     exact arm folds on its own and `findActorRowByUsername` never issues the
//     folded query there — nothing would read this index. Translating it would
//     also be the least portable branch of the three: MySQL requires the extra
//     parentheses of `((lower(username)), domain)`, rejects `IF NOT EXISTS` on
//     `CREATE INDEX`, quotes identifiers with backticks unless `ANSI_QUOTES` is
//     set, only gained functional indexes in 8.0.13, and MariaDB — which the
//     `mysql2` client also connects to — has never had them.
//
// It is NOT unique on the backends that do get it. This instance may already
// hold local actors that differ only by case, minted before usernames were
// normalized and left in place because their ActivityPub ids are already
// federated; a unique index would refuse to build on any such instance.
// Case-collision is refused at the application layer instead, by
// `isUsernameExists`.
//
// Worth knowing for anything built on top of this: PostgreSQL and SQLite do not
// fold the same alphabet. PostgreSQL's `lower()` is locale-aware; SQLite's is
// ASCII only. So a remote actor named `Фёдор` is found case-insensitively on
// PostgreSQL and only by its exact spelling on SQLite. That is why the exact
// match is tried FIRST rather than being replaced by the folded one — the fold
// is an addition, and no lookup that resolves today can stop resolving.

const INDEX_NAME = 'actors_lower_username_domain_idx'

const MYSQL_CLIENTS = new Set(['mysql', 'mysql2'])

const isMySQL = (knex) =>
  MYSQL_CLIENTS.has(String(knex.client.config.client).toLowerCase())

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  if (isMySQL(knex)) return

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "actors" (lower("username"), "domain")`
  )
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  if (isMySQL(knex)) return

  await knex.raw(`DROP INDEX IF EXISTS "${INDEX_NAME}"`)
}
