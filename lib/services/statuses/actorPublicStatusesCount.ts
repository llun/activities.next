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
// not trusted as the only one: a CDN may key on headers that differ per
// request, and a signed server-to-server fetch — what federation actually sends
// — carries several. Whether any given deployment's shared cache collapses a
// burst is a property of its configuration, not of this response, so the origin
// has to be able to absorb one by itself.
//
// Caching the PROMISE rather than the resolved count is what makes a concurrent
// miss free: it needs no second map of in-flight queries, and no reasoning about
// which settles first. `getMySQLFullTextMinTokenSize` in
// `lib/database/sql/search/documents.ts` does the same, and deletes its entry on
// failure for the same reason this does.
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
//
// An entry is inserted while its query still runs, so at capacity a pending one
// can be evicted, and a later miss for that actor then starts a second query
// rather than joining the first. Reaching that needs 512 OTHER actors queried
// inside one ~150ms count — far past anything this cache was built for, and the
// cost is a duplicate query, never a wrong count — so it is left alone rather
// than pinned open with a second map of in-flight queries.
export const MAX_CACHED_ACTORS = 512

type CacheEntry = {
  // Still pending for as long as the query runs, so a concurrent miss joins it
  // instead of starting a second one.
  count: Promise<number>
  // Counted from when the query STARTS, which on a 60s TTL differs from when it
  // resolves by the length of one query — and the count it caches is a snapshot
  // of the moment it began reading anyway.
  expiresAt: number
}

let cacheByDatabase = new WeakMap<Database, Map<string, CacheEntry>>()

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

const getActorEntries = (database: Database) => {
  const entries = cacheByDatabase.get(database)
  if (entries) return entries

  const actorEntries = new Map<string, CacheEntry>()
  cacheByDatabase.set(database, actorEntries)
  return actorEntries
}

/**
 * `database.getActorStatusesCount({ actorId, publicOnly: true })` behind a
 * per-actor TTL cache that also collapses concurrent misses into one query.
 *
 * Errors are not cached: a rejection removes the entry, so the next caller
 * retries rather than being served a failure for a minute, and every caller
 * already awaiting that query sees the rejection rather than hanging.
 */
export const getCachedActorPublicStatusesCount = (
  database: Database,
  actorId: string
): Promise<number> => {
  // Read and write are both synchronous, with no `await` between them. Reading
  // the cache before the query and writing it after used to drop a
  // concurrently-computed entry for a DIFFERENT actor: both callers found no
  // map for a cold database, each built one, and the later write replaced the
  // earlier wholesale.
  const entries = getActorEntries(database)
  const entry = entries.get(actorId)
  if (entry && entry.expiresAt > Date.now()) return entry.count

  const count = database
    .getActorStatusesCount({ actorId, publicOnly: true })
    .catch((error) => {
      // Only if this entry is still the cached one: a later miss may already
      // have replaced it, and that successor's query is not this one's to
      // discard.
      if (entries.get(actorId)?.count === count) entries.delete(actorId)
      throw error
    })

  setBoundedEntry(entries, actorId, {
    count,
    expiresAt: Date.now() + ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS
  })
  return count
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

  return [...(cacheByDatabase.get(database)?.keys() ?? [])]
}
