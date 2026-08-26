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
// more of it. This holds each actor's count for a TTL, and the `Cache-Control`
// the outbox root now sends keeps most of a burst from reaching the origin at
// all. Note what it does NOT do: there is no in-flight dedup, so concurrent
// misses for one actor all run the query — the entry is only written once the
// query resolves. The CDN is what absorbs a burst; a sub-TTL stampede is a
// different, unmeasured failure mode.
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
 * per-actor TTL cache.
 *
 * Errors are not cached: a rejection propagates before anything is written, so
 * the next caller retries rather than being served a failure for a minute.
 */
export const getCachedActorPublicStatusesCount = async (
  database: Database,
  actorId: string
): Promise<number> => {
  // The map is created and published BEFORE the query, so every caller racing
  // on a cold database key mutates the one map instead of each building its own
  // and the last to finish replacing the rest. Reading it before the `await`
  // and writing it after dropped a concurrently-computed entry for a DIFFERENT
  // actor — not a wrong count, but a lost one, so that actor recomputed on its
  // next request well inside the TTL. Publishing an empty map costs nothing:
  // only `setBoundedEntry` below puts anything in it, and a reader that finds
  // it empty simply misses.
  const entries = getActorEntries(database)
  const entry = entries.get(actorId)
  if (entry && entry.expiresAt > Date.now()) return entry.count

  const count = await database.getActorStatusesCount({
    actorId,
    publicOnly: true
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
