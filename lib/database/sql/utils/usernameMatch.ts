import { Knex } from 'knex'

import { isMySQLClient } from '@/lib/database/sql/utils/knex'
import { SQLActor } from '@/lib/types/database/rows'

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
 * `domain` matching is left case-sensitive, which is what it already was before
 * this helper existed — folding it is a separate change, with its own index
 * implications, and it is not this helper's question. Do NOT read that as
 * "callers normalize it first": `parseAccountHandle` does, but
 * `app/api/v1/accounts/lookup/route.ts` has its own locally-shadowed
 * `parseAccountHandle` that does not, and
 * `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts` splits the segment
 * inline with no normalization at all. `getWebFingerResponse` carries its own
 * exact-then-lowercased domain fallback precisely because that is not a
 * guarantee. Note `getExactAccountIds` in `lib/database/sql/search/` DOES fold
 * domain, so search and lookup disagree on `alice@Example.COM` — pre-existing,
 * and not something this helper can fix on its own.
 *
 * The fold is `toLowerCase()` and NOT `normalizeUsername`, even though that is
 * the mint-side spelling of the same idea. `normalizeUsername` also trims, and
 * trimming here would fold whitespace as well as case — against an untrimmed
 * `lower(username)`, so asymmetrically. `GET /users/%20alice%20` decodes to
 * `' alice '`, and a trimming fold served alice's actor document, inbox, outbox
 * and followers there; the outbox root sends
 * `Cache-Control: public, max-age=60, s-maxage=60`, so every spelling was its
 * own shared-cache key for one identical body. A caller that wants whitespace
 * tolerance trims before asking, which `parseAccountHandle` already does.
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
    .whereRaw('lower(??) = ?', ['username', username.toLowerCase()])
    .andWhere('domain', domain)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .first()
}
