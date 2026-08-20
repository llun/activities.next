import { Database } from '@/lib/database/types'

// The logged-out landing page gates its public-timeline preview on the server
// holding at least N public posts. That gate is a three-table query on the
// unauthenticated front door, so every anonymous visit — every crawler included
// — used to pay for it, to re-derive an answer that changes at most once in an
// instance's life.
//
// Caching is per database instance so the production singleton is cached while
// each test's throwaway database resolves independently, and per `limit` so a
// caller asking a different threshold never reads another's answer.

// A below-threshold answer is worth re-checking: a young server is filling up,
// and this bounds how long its landing keeps showing the hero after it crosses.
export const BELOW_THRESHOLD_CACHE_TTL_MS = 60_000

type CacheEntry = {
  limit: number
  count: number
  // Absent for a result that reached the threshold — see below.
  expiresAt?: number
}

const cacheByDatabase = new WeakMap<Database, CacheEntry>()

/**
 * `database.getLocalPublicStatusesCount(limit)` behind a cache.
 *
 * Once the count reaches `limit` the result is memoized for the lifetime of the
 * process, with no expiry. The threshold is one-way in practice: posts are
 * effectively only added, and the gate exists to keep a *sparse* server from
 * leading with a near-empty feed — not to withdraw the preview from a server
 * that has already earned it. Deleting back under the threshold is possible but
 * so rare, and so harmless when it lags, that re-querying forever to catch it
 * would cost far more than it could ever save.
 *
 * Errors are not cached and propagate to the caller, which already degrades to
 * the brand hero rather than failing the page.
 */
export const getCachedLocalPublicStatusesCount = async (
  database: Database,
  limit: number
): Promise<number> => {
  const entry = cacheByDatabase.get(database)
  if (
    entry &&
    entry.limit === limit &&
    (entry.expiresAt === undefined || entry.expiresAt > Date.now())
  ) {
    return entry.count
  }

  const count = await database.getLocalPublicStatusesCount(limit)
  cacheByDatabase.set(database, {
    limit,
    count,
    ...(count >= limit
      ? {}
      : { expiresAt: Date.now() + BELOW_THRESHOLD_CACHE_TTL_MS })
  })
  return count
}
