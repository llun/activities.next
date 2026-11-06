// A sign-out whose clear of the staged shares failed (or timed out) must not
// leave them for the next account on the device: a `?share=<id>` URL in the
// history would still open them. Like the drafts' pending purge
// (lib/client/drafts/pendingPurgeMarker.ts), sign-out records a marker before
// it clears, outside IndexedDB (the store that failed), and removes it once the
// clear succeeds. Every reader honours it first (`honourPendingSharePurge` in
// shareTargetDb.ts, and public/sw.js before it stages).
//
// The marker is the sign-out time. Only shares staged up to then are purged, so
// a share the next account makes afterwards survives. It is kept in
// localStorage for the pages (one value, compared and removed synchronously)
// and in Cache Storage for the service worker, which has no localStorage. In
// the cache every sign-out writes its own entry, keyed by its time, so retiring
// one generation deletes only its own keys: there is no read-then-delete of a
// shared key that a newer sign-out could slip into. public/sw.js names the same
// cache and key prefix.
const STORAGE_KEY = 'activities-share-target-pending-purge'
export const SHARE_PURGE_CACHE = 'activities-share-target-purge-v1'
export const SHARE_PURGE_CACHE_KEY_PREFIX = '/__share-target-pending-purge/'

const parse = (value: string | null | undefined): number | null => {
  const markedAt = Number(value)
  return value && Number.isFinite(markedAt) ? markedAt : null
}

const readStored = (): number | null => {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

// Absolute, as Cache Storage keys resolve to; the pathname carries the time.
const cacheKeyFor = (markedAt: number) =>
  `${window.location.origin}${SHARE_PURGE_CACHE_KEY_PREFIX}${markedAt}`

const timeOfCacheKey = (request: Request): number | null => {
  try {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith(SHARE_PURGE_CACHE_KEY_PREFIX)) return null
    return parse(pathname.slice(SHARE_PURGE_CACHE_KEY_PREFIX.length))
  } catch {
    return null
  }
}

const openPurgeCache = async (): Promise<Cache | null> => {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(SHARE_PURGE_CACHE)
  } catch {
    return null
  }
}

// Every cached generation, as [key, time].
const readCachedGenerations = async (
  cache: Cache
): Promise<[Request, number][]> => {
  try {
    const generations: [Request, number][] = []
    for (const request of await cache.keys()) {
      const markedAt = timeOfCacheKey(request)
      if (markedAt !== null) generations.push([request, markedAt])
    }
    return generations
  } catch {
    return []
  }
}

/**
 * Records that shares staged up to `markedAt` are still to be deleted, and
 * returns it: the caller settles this generation, and only this one. The
 * localStorage copy is written before anything awaits.
 */
export const markSharePurgePending = async (
  markedAt: number = Date.now()
): Promise<number> => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(markedAt))
  } catch {
    // Kept in Cache Storage below, or not at all: the clear is still tried.
  }
  try {
    const cache = await openPurgeCache()
    await cache?.put(cacheKeyFor(markedAt), new Response(String(markedAt)))
  } catch {
    // Cache Storage unavailable: the pages still have localStorage.
  }
  return markedAt
}

/**
 * The newest pending purge's sign-out time across localStorage and every
 * cached generation, or null when none is pending. Purging up to the newest
 * also covers any older one.
 */
export const readSharePurgePending = async (): Promise<number | null> => {
  const times: number[] = []
  const stored = readStored()
  if (stored !== null) times.push(stored)
  const cache = await openPurgeCache()
  if (cache) {
    for (const [, markedAt] of await readCachedGenerations(cache)) {
      times.push(markedAt)
    }
  }
  return times.length > 0 ? Math.max(...times) : null
}

/**
 * The purge up to `markedAt` is done. localStorage loses its value only if it
 * still holds that time; the cache loses only the generations at or before it,
 * each by its own key. A newer sign-out's marker, written while this purge
 * waited on IndexedDB, stays for the next purge.
 */
export const settleSharePurge = async (markedAt: number): Promise<void> => {
  try {
    if (readStored() === markedAt) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }
  const cache = await openPurgeCache()
  if (!cache) return
  for (const [request, time] of await readCachedGenerations(cache)) {
    if (time > markedAt) continue
    try {
      await cache.delete(request)
    } catch {
      // Left for the next purge, which only deletes older shares again.
    }
  }
}
