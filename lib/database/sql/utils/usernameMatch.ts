import { Knex } from 'knex'

import { isMySQLClient } from '@/lib/database/sql/utils/knex'
import { SQLActor } from '@/lib/types/database/rows'
import { normalizeUsername } from '@/lib/utils/normalizeUsername'

/**
 * Resolves `(username, domain)` to an actor row case-insensitively.
 *
 * Two queries rather than one `lower(username) = ?`, for two independent
 * reasons:
 *
 *  1. CORRECTNESS. SQL `lower()` and JS `toLowerCase()` are not the same
 *     function. SQLite's builtin folds ASCII only, so for a remote actor named
 *     `Фёдор` the stored value folds to `Фёдор` while the JS side folds the
 *     identical input to `фёдор` — a single folded query would stop finding a
 *     row that an exact match finds today. Trying the exact match first means
 *     no lookup that works now can break, on any backend, for any charset.
 *  2. PRECEDENCE. This instance may already hold local actors that differ only
 *     by case, minted before usernames were normalized; those rows are left
 *     alone precisely because their ids are already federated. `/@Alice` must
 *     keep resolving to `Alice` and not to whichever row the index happens to
 *     yield first, and "exact wins" says that without a tiebreak clause.
 *
 * The exact arm uses `actors_username_domain_unique`; the folded arm uses the
 * functional `actors_lower_username_domain_idx` from
 * `20260826120000_add_actors_lower_username_index.js`. The folded arm runs only
 * on a miss, so the hot path is exactly the query this replaced.
 *
 * Ordering on the folded arm is `createdAt` then `id`: with the exact row
 * already ruled out, more than one case-variant is possible, and the account
 * that claimed the name first is both a defensible winner and a stable one.
 * `.first()` alone would be neither.
 *
 * `domain` matching is left case-sensitive. Callers already lowercase it
 * (`parseAccountHandle`), and WebFinger carries its own exact-then-lowercased
 * domain fallback; folding it here would silently change which host a handle
 * resolves on, which is not this helper's question.
 *
 * MySQL takes the exact arm only, and that is not a gap. Its default collations
 * (`utf8mb4_0900_ai_ci` and friends) are case-insensitive, so `username = ?`
 * has ALREADY folded — and so has `actors_username_domain_unique`, which means
 * a case-colliding pair cannot exist there to begin with. A second query would
 * find nothing the first did not, and would find it by scanning `actors`: the
 * folded arm's index is deliberately not created on MySQL, because MariaDB has
 * no functional indexes at all and MySQL only gained them in 8.0.13. An
 * operator who puts a `_bin` or `_cs` collation on `actors` gets case-sensitive
 * usernames, which is what they asked their database for.
 */
export const findActorRowByUsername = async (
  database: Knex,
  { username, domain }: { username: string; domain: string }
): Promise<SQLActor | undefined> => {
  const exactMatch = await database<SQLActor>('actors')
    .where('username', username)
    .andWhere('domain', domain)
    .first()
  if (exactMatch || isMySQLClient(database)) return exactMatch

  return database<SQLActor>('actors')
    .whereRaw('lower(??) = ?', ['username', normalizeUsername(username)])
    .andWhere('domain', domain)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .first()
}
