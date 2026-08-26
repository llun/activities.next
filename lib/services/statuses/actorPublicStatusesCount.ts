import { Database } from '@/lib/database/types'

// `getActorStatusesCount({ publicOnly: true })` is the outbox collection's
// `totalItems`, and it is expensive on purpose: there is no counter for it and
// there cannot be one — an Announce stays publicly readable only while the
// status it boosts does, and that status belongs to another actor whose edits
// and deletes never touch this actor's rows. So it is a recursive CTE over the
// actor's whole public history, ~100–160ms of CPU for an actor with ~1,900
// public statuses.
//
// Nothing above it deduplicated the work. On 2026-08-25 a burst of 530 outbox
// root fetches in 11 minutes each recomputed the count and queued behind one
// another on a 1-vCPU instance, taking the query's average wall time to 899ms
// against ~150ms of real work — the executions were waiting for CPU, not doing
// more of it. This holds each actor's count for a TTL AND collapses concurrent
// misses into a single query, and the two matter for different halves of a
// burst: the TTL bounds requests arriving after a count has been computed, and
// the in-flight dedup bounds the ones arriving while it still runs — which at
// ~150ms a count and 530 fetches in 11 minutes is a real share of them.
//
// The `Cache-Control` the outbox root sends is a third layer, and deliberately
// not trusted as the only one. A CDN in front may key on more than the URL:
// llun.dev's ActivityPub cache policy includes `Signature` and `Date`, both of
// which differ per request, so signed server-to-server fetches — the ones
// federation actually makes — each take their own cache entry and collapse into
// nothing. The origin has to be able to absorb the burst by itself.
//
// Keyed per database instance so the production singleton is cached while each
// test's throwaway database resolves independently, and per actor because one
// instance serves several — including the headless federation signing actor.

// A count that lags by up to a minute is within what an ActivityPub collection
// promises: `totalItems` already cannot be exact the moment another actor edits
// or deletes a status this one boosted.
export const ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS = 60_000

// The entries expire but nothing sweeps them, and a public outbox is fetched
// for whichever actors remote servers ask about. Bound the map so a long-lived
// process cannot accumulate one entry per actor it has ever served.
export const MAX_CACHED_ACTORS = 512

type CacheEntry = {
  count: number
  expiresAt: number
}

type DatabaseCache = {
  entries: Map<string, CacheEntry>
  // The query each actor already has in flight, so concurrent misses await one
  // rather than each running their own. Self-clearing on settle, so its size is
  // bounded by concurrent requests rather than by actors, and it needs no cap of
  // its own.
  inFlight: Map<string, Promise<number>>
}

let cacheByDatabase = new WeakMap<Database, DatabaseCache>()

// Insertion-order eviction, mirroring `setBoundedCacheValue` in
// `lib/utils/host.ts` — that one is module-private to an unrelated domain, so
// this is a deliberate second copy rather than an export widened for one caller.
const setBoundedEntry = (
  entries: Map<string, CacheEntry>,
  actorId: string,
  entry: CacheEntry
) => {
  if (entries.has(actorId)) {
    entries.delete(actorId)
  } else if (entries.size >= MAX_CACHED_ACTORS) {
    const oldestActorId = entries.keys().next().value
    if (oldestActorId !== undefined) entries.delete(oldestActorId)
  }

  entries.set(actorId, entry)
}

const getDatabaseCache = (database: Database) => {
  const cache = cacheByDatabase.get(database)
  if (cache) return cache

  const databaseCache: DatabaseCache = {
    entries: new Map(),
    inFlight: new Map()
  }
  cacheByDatabase.set(database, databaseCache)
  return databaseCache
}

/**
 * `database.getActorStatusesCount({ actorId, publicOnly: true })` behind a
 * per-actor TTL cache that also collapses concurrent misses into one query.
 *
 * Errors are not cached: a rejection settles the in-flight entry without
 * writing a count, so the next caller retries rather than being served a
 * failure for a minute. Every caller already awaiting that query sees the
 * rejection too, rather than hanging.
 */
export const getCachedActorPublicStatusesCount = (
  database: Database,
  actorId: string
): Promise<number> => {
  // Everything up to the query is synchronous, which is what makes the two maps
  // safe. Reading the cache before the query and writing it after used to drop
  // a concurrently-computed entry for a DIFFERENT actor: both callers found no
  // map for a cold database, each built one, and the later write replaced the
  // earlier wholesale.
  const cache = getDatabaseCache(database)
  const entry = cache.entries.get(actorId)
  if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.count)

  // A burst arrives faster than one count takes to run, so without this the
  // first N requests all recompute — the CDN cannot be relied on to absorb them
  // for signed federation traffic, whose per-request `Signature` and `Date`
  // make every fetch a distinct shared-cache entry.
  const inFlight = cache.inFlight.get(actorId)
  if (inFlight) return inFlight

  const query = database
    .getActorStatusesCount({ actorId, publicOnly: true })
    .then((count) => {
      setBoundedEntry(cache.entries, actorId, {
        count,
        expiresAt: Date.now() + ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS
      })
      return count
    })
    .finally(() => {
      cache.inFlight.delete(actorId)
    })

  // Settling cannot have run yet — a `then`/`finally` callback is a microtask
  // and nothing has yielded since the chain was built — so this cannot delete
  // an entry it then re-adds.
  cache.inFlight.set(actorId, query)
  return query
}

export const resetActorPublicStatusesCountCacheForTests = () => {
  if (!process.env.VITEST) {
    throw new Error('resetActorPublicStatusesCountCacheForTests is test-only')
  }

  cacheByDatabase = new WeakMap()
}

// The cached actor ids in insertion order — oldest first, which is the order
// `setBoundedEntry` evicts in. Returning the ids rather than a count is what
// lets a test assert WHICH actor was evicted; a size alone passes against an
// eviction that drops the wrong one.
export const getActorPublicStatusesCountCachedActorIdsForTests = (
  database: Database
) => {
  if (!process.env.VITEST) {
    throw new Error(
      'getActorPublicStatusesCountCachedActorIdsForTests is test-only'
    )
  }

  return [...(cacheByDatabase.get(database)?.entries.keys() ?? [])]
}
