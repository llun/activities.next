import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

export type LookupCacheKind =
  'gbif-match' | 'gbif-taxon' | 'gbif-search' | 'geocode'

// How long each outcome of each kind is trusted. A hit is trusted longest, a
// miss for less (so a new name can appear), an error only briefly (so a
// provider that comes back is used again soon, without being hammered meanwhile).
export const LOOKUP_CACHE_TTL_MS: Record<
  LookupCacheKind,
  { ok: number; miss: number; error: number }
> = {
  'gbif-match': { ok: 30 * DAY, miss: 7 * DAY, error: 10 * MINUTE },
  'gbif-taxon': { ok: 30 * DAY, miss: 7 * DAY, error: 10 * MINUTE },
  'gbif-search': { ok: DAY, miss: DAY, error: 10 * MINUTE },
  geocode: { ok: 180 * DAY, miss: 30 * DAY, error: 10 * MINUTE }
}

export type CachedLookup<T> =
  | { status: 'ok'; value: T }
  // The provider has nothing for this key.
  | { status: 'miss' }
  // The lookup failed now, or failed recently enough to be remembered.
  | { status: 'error'; error?: unknown }

const inFlight = new Map<string, Promise<CachedLookup<unknown>>>()

/**
 * Read-through lookup cache over `gallery_lookup_cache`, with negative caching
 * and single-flight: concurrent calls for the same kind and key share one
 * fetch, so a burst of uploads from one place makes one request.
 *
 * `fetcher` answers the value, or null for "the provider has nothing". It may
 * throw; the failure is remembered briefly and returned as `status: 'error'`.
 * A cache that cannot be read or written never fails the lookup; it only
 * means the provider is asked again.
 *
 * `skipCachedError` is for the owner's Retry: a remembered failure is asked
 * again instead of being answered from the cache (an open circuit still fails
 * fast, in `lookupGet`). Hits and misses are still served from the cache.
 */
export const readThroughLookupCache = async <T>({
  database,
  kind,
  key,
  fetcher,
  skipCachedError = false
}: {
  database: Database
  kind: LookupCacheKind
  key: string
  fetcher: () => Promise<T | null>
  skipCachedError?: boolean
}): Promise<CachedLookup<T>> => {
  const flightKey = `${kind}:${key}`
  const existing = inFlight.get(flightKey)
  if (existing) return existing as Promise<CachedLookup<T>>

  const run = async (): Promise<CachedLookup<T>> => {
    try {
      const cached = await database.getGalleryLookup({ kind, key })
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.outcome === 'miss') return { status: 'miss' }
        if (cached.outcome === 'error' && !skipCachedError) {
          return { status: 'error' }
        }
        if (
          cached.outcome === 'ok' &&
          cached.value !== null &&
          cached.value !== undefined
        ) {
          return { status: 'ok', value: cached.value as T }
        }
        // An ok row with no value is corrupt; it is refetched below.
      }
    } catch (error) {
      logger.warn({
        message: 'Gallery lookup cache read failed',
        kind,
        err: toLoggableError(error)
      })
    }

    const ttl = LOOKUP_CACHE_TTL_MS[kind]
    const write = async (
      outcome: 'ok' | 'miss' | 'error',
      value: unknown,
      ttlMs: number
    ) => {
      try {
        await database.putGalleryLookup({ kind, key, outcome, value, ttlMs })
      } catch (error) {
        logger.warn({
          message: 'Gallery lookup cache write failed',
          kind,
          err: toLoggableError(error)
        })
      }
    }

    let value: T | null
    try {
      value = await fetcher()
    } catch (error) {
      await write('error', null, ttl.error)
      return { status: 'error', error }
    }

    if (value === null) {
      await write('miss', null, ttl.miss)
      return { status: 'miss' }
    }
    await write('ok', value, ttl.ok)
    return { status: 'ok', value }
  }

  const promise = run().finally(() => {
    inFlight.delete(flightKey)
  })
  inFlight.set(flightKey, promise as Promise<CachedLookup<unknown>>)
  return promise
}
