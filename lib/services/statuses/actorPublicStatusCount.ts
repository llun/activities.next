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
// more of it. This bounds the recomputation to once per actor per TTL, and the
// `Cache-Control` the outbox root now sends keeps most of the burst from
// reaching the origin at all.
//
// Keyed per database instance so the production singleton is cached while each
// test's throwaway database resolves independently, and per actor because one
// instance serves several — including the headless federation signing actor.

// A count that lags by up to a minute is within what an ActivityPub collection
// promises: `totalItems` already cannot be exact the moment another actor edits
// or deletes a status this one boosted.
export const ACTOR_PUBLIC_STATUS_COUNT_TTL_MS = 60_000

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

/**
 * `database.getActorStatusesCount({ actorId, publicOnly: true })` behind a
 * per-actor TTL cache.
 *
 * Errors are not cached: a rejection propagates before anything is written, so
 * the next caller retries rather than being served a failure for a minute.
 */
export const getCachedActorPublicStatusCount = async (
  database: Database,
  actorId: string
): Promise<number> => {
  const entries = cacheByDatabase.get(database)
  const entry = entries?.get(actorId)
  if (entry && entry.expiresAt > Date.now()) return entry.count

  const count = await database.getActorStatusesCount({
    actorId,
    publicOnly: true
  })

  const actorEntries = entries ?? new Map<string, CacheEntry>()
  setBoundedEntry(actorEntries, actorId, {
    count,
    expiresAt: Date.now() + ACTOR_PUBLIC_STATUS_COUNT_TTL_MS
  })
  cacheByDatabase.set(database, actorEntries)
  return count
}

export const resetActorPublicStatusCountCacheForTests = () => {
  if (!process.env.VITEST) {
    throw new Error('resetActorPublicStatusCountCacheForTests is test-only')
  }

  cacheByDatabase = new WeakMap()
}

export const getActorPublicStatusCountCacheSizeForTests = (
  database: Database
) => {
  if (!process.env.VITEST) {
    throw new Error('getActorPublicStatusCountCacheSizeForTests is test-only')
  }

  return cacheByDatabase.get(database)?.size ?? 0
}
