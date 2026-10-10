import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'

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
 * A bare `limit 1` would be neither.
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
 * guarantee. Note `getExactAccountIds` in `lib/database/domains/search/` DOES fold
 * domain, so search and lookup disagree on `alice@Example.COM` — pre-existing,
 * and not something this helper can fix on its own.
 *
 * The fold is `toLowerCase()` and NOT `normalizeUsername`, even though that is
 * the mint-side spelling of the same idea. `normalizeUsername` also trims, and
 * a trim here is not a fold at all: it compares a TRIMMED input against an
 * UNTRIMMED `lower(username)`, so the relation is asymmetric — `' alice '`
 * found `alice`, while `alice` could never find a stored `'alice '`. An
 * asymmetric match can only ever ADD rows the exact arm would not have found,
 * which is how `GET /users/%20alice%20` came to serve alice's actor document,
 * inbox, outbox and followers.
 *
 * (An earlier version of this comment justified the fix by the outbox root's
 * `Cache-Control: public, max-age=60, s-maxage=60` turning each spelling into
 * its own shared-cache key. That is true but NOT load-bearing: case folding is
 * this helper's whole point, so `/users/AlIcE/outbox` and its siblings remain
 * distinct cacheable URLs regardless. The asymmetry above is the real reason,
 * and the origin cost per variant is small because
 * `getCachedActorPublicStatusesCount` memoizes per `actorId`, not per URL.)
 *
 * A caller wanting whitespace tolerance trims before asking, which
 * `parseAccountHandle` and `getWebFingerResponse` already do.
 *
 * There is no MySQL branch: the Kysely layer runs on SQLite and PostgreSQL
 * only. (The Knex helper this replaced took the exact arm alone on MySQL,
 * whose default collations already fold case.)
 */
export const findActorRowByUsername = async (
  db: Db,
  { username, domain }: { username: string; domain: string }
) => {
  const exactMatch = await db
    .selectFrom('actors')
    .selectAll()
    .where('username', '=', username)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()
  if (exactMatch) return exactMatch

  return db
    .selectFrom('actors')
    .selectAll()
    .where(sql`lower(${sql.ref('username')})`, '=', username.toLowerCase())
    .where('domain', '=', domain)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst()
}
