import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { snapToGrid } from '@/lib/services/gallery/publicMediaDetails'

import { GeocodedPlace, formatGeocodedPlace } from './formatGeocodedPlace'
import { readThroughLookupCache } from './lookupCache'
import {
  LookupError,
  LookupFetch,
  LookupProvider,
  lookupGet
} from './lookupRequest'
import { createCircuitBreaker, createLimiter } from './rateLimit'

// Nominatim's usage policy allows at most one request per second and asks for
// an identifying User-Agent. A caller that would wait more than ten seconds
// for its turn gets a `rate-limited` LookupError instead.
export const nominatimProvider: LookupProvider = {
  name: 'Nominatim',
  limiter: createLimiter({
    maxConcurrent: 1,
    minIntervalMs: 1_100,
    maxWaitMs: 10_000
  }),
  breaker: createCircuitBreaker(),
  timeoutMs: 5_000,
  connectTimeoutMs: 2_000,
  maxBodyBytes: 64 * 1024
}

export interface SnappedPoint {
  latitude: number
  longitude: number
}

/**
 * The only point that ever leaves this server: the centre of the 0.05 degree
 * cell the photo is in, the same grid as the public `area` precision.
 */
export const snapPoint = (point: SnappedPoint): SnappedPoint => ({
  latitude: snapToGrid(point.latitude),
  longitude: snapToGrid(point.longitude)
})

export interface NominatimClientDeps {
  database: Database
  fetch?: LookupFetch
  provider?: LookupProvider
  endpoint?: string
  email?: string | null
  language?: string
  // The owner's Retry: ask again rather than answer a remembered failure.
  skipCachedErrors?: boolean
}

export interface NominatimClient {
  /**
   * The place name and country code of the 0.05 degree cell that contains
   * `point`. The point is snapped here, before anything is cached or sent, so
   * the stored coordinates never appear in a URL or a cache key. Null when
   * Nominatim has no name for the cell (open sea). Throws LookupError when
   * the lookup failed. Cached as `geocode`.
   */
  reverseGeocode(point: SnappedPoint): Promise<GeocodedPlace | null>
}

export const createNominatimClient = ({
  database,
  fetch,
  provider = nominatimProvider,
  endpoint,
  email,
  language,
  skipCachedErrors = false
}: NominatimClientDeps): NominatimClient => ({
  async reverseGeocode(point) {
    const config = getConfig()
    const snapped = snapPoint(point)
    const lang = language ?? config.languages?.[0] ?? 'en'
    const latitude = snapped.latitude.toFixed(2)
    const longitude = snapped.longitude.toFixed(2)

    const result = await readThroughLookupCache<GeocodedPlace>({
      database,
      skipCachedError: skipCachedErrors,
      kind: 'geocode',
      key: `${lang}:${latitude},${longitude}`,
      fetcher: async () => {
        const base = (endpoint ?? config.gallery.nominatim.endpoint).replace(
          /\/+$/,
          ''
        )
        const url = new URL(`${base}/reverse`)
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('lat', latitude)
        url.searchParams.set('lon', longitude)
        url.searchParams.set('zoom', '10')
        url.searchParams.set('addressdetails', '1')
        const contact =
          email === undefined ? config.gallery.nominatim.email : email
        if (contact) url.searchParams.set('email', contact)

        const response = await lookupGet({
          provider,
          url: url.toString(),
          fetch
        })
        if (response.status !== 'ok') return null
        // Nominatim's "nothing here" is `{ "error": "Unable to geocode" }`.
        // Anything else without an address is a shape this code does not
        // know: a failure to retry, not a cell with no name.
        const json = response.json as {
          address?: unknown
          error?: unknown
        } | null
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
          throw new LookupError(
            'parse',
            'Nominatim returned an unreadable answer'
          )
        }
        if (json.address === undefined) {
          if (typeof json.error === 'string') return null
          throw new LookupError(
            'parse',
            'Nominatim returned an unreadable answer'
          )
        }
        return formatGeocodedPlace(json)
      }
    })

    if (result.status === 'ok') return result.value
    if (result.status === 'miss') return null
    if (result.error instanceof LookupError) throw result.error
    throw new LookupError('unavailable', 'Nominatim lookup failed recently')
  }
})
