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
// localStorage for the pages and copied to Cache Storage for the service
// worker, which has no localStorage; public/sw.js names the same cache.
const STORAGE_KEY = 'activities-share-target-pending-purge'
export const SHARE_PURGE_CACHE = 'activities-share-target-purge-v1'
export const SHARE_PURGE_CACHE_KEY = '/__share-target-pending-purge'

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

const readCached = async (): Promise<number | null> => {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(SHARE_PURGE_CACHE)
    const response = await cache.match(SHARE_PURGE_CACHE_KEY)
    return response ? parse(await response.text()) : null
  } catch {
    return null
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
    if (typeof caches === 'undefined') return markedAt
    const cache = await caches.open(SHARE_PURGE_CACHE)
    await cache.put(SHARE_PURGE_CACHE_KEY, new Response(String(markedAt)))
  } catch {
    // Cache Storage unavailable: the pages still have localStorage.
  }
  return markedAt
}

/**
 * The newest pending purge's sign-out time across both copies, or null when
 * none is pending. Purging up to the newest also covers any older one.
 */
export const readSharePurgePending = async (): Promise<number | null> => {
  const stored = readStored()
  const cached = await readCached()
  if (stored === null) return cached
  if (cached === null) return stored
  return Math.max(stored, cached)
}

/**
 * The purge up to `markedAt` is done: each copy of the marker goes only if it
 * still holds that time. A newer sign-out may have written its own while this
 * purge waited on IndexedDB; that one stays for the next purge.
 */
export const settleSharePurge = async (markedAt: number): Promise<void> => {
  try {
    if (readStored() === markedAt) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }
  try {
    if (typeof caches === 'undefined') return
    if ((await readCached()) !== markedAt) return
    const cache = await caches.open(SHARE_PURGE_CACHE)
    await cache.delete(SHARE_PURGE_CACHE_KEY)
  } catch {
    // Nothing cached.
  }
}
