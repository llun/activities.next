import { getConfig } from '@/lib/config'
import { DEFAULT_GBIF_ENDPOINT } from '@/lib/config/gallery'
import { Database } from '@/lib/database/types'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { readThroughLookupCache } from './lookupCache'
import {
  IsEmptyAnswer,
  LookupError,
  LookupFetch,
  LookupProvider,
  lookupGet
} from './lookupRequest'
import {
  IucnCategory,
  NormalizedTaxon,
  UncertainMatch,
  classifyMatch,
  normalizeIucnCategory,
  normalizeTaxonRecord
} from './normalizeTaxon'
import { createCircuitBreaker, createLimiter } from './rateLimit'

// Every GBIF call lives in this module. GBIF is moving to a new backbone, so
// the response shapes are read in normalizeTaxon.ts and the recorded fixtures
// in __fixtures__ document what was seen; nothing else touches the API.

// The GBIF Backbone Taxonomy. Searching it (rather than every checklist)
// makes each result's key a backbone key, which is what species/match and
// species/{key} agree on.
const GBIF_BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const MAX_SEARCH_RESULTS = 10
// The vernacular names kept on a result for display. Matching a common name
// reads every name GBIF answered, not just these.
const MAX_VERNACULAR_NAMES = 20
// The longest query `species/search` is asked; a longer one is cut.
const MAX_SEARCH_QUERY_LENGTH = 100

export const gbifProvider: LookupProvider = {
  name: 'GBIF',
  // At most 4 at a time and 10 requests per second.
  limiter: createLimiter({ maxConcurrent: 4, minIntervalMs: 100 }),
  breaker: createCircuitBreaker(),
  timeoutMs: 5_000,
  connectTimeoutMs: 2_000,
  maxBodyBytes: 256 * 1024
}

export interface GbifTaxon extends NormalizedTaxon {
  vernacularName: string | null
  // Null when GBIF has no IUCN assessment for the taxon (or its species).
  iucnCategory: IucnCategory | null
}

export interface GbifTaxonSearchResult extends NormalizedTaxon {
  // The best name to show: English where there is one.
  vernacularName: string | null
  vernacularNames: string[]
}

export interface GbifMatchOptions {
  // A kingdom hint ("Animalia", "Plantae") that sharpens an ambiguous name.
  kingdom?: string
  // Accept a genus or family, for a "group" pick.
  allowHigherRank?: boolean
}

/**
 * What `species/match` made of a name (see `classifyMatch`):
 * - `match`: a confident match (see `matchTaxon`).
 * - `none`: GBIF's own NONE. The only answer that means "GBIF does not know
 *   this name".
 * - `uncertain`: GBIF placed the name in a species or genus, but only as a
 *   HIGHERRANK answer or below the confidence bar. "Pongo abelii xyz" is a
 *   HIGHERRANK answer naming the Sumatran orangutan (CR), so this is NOT a
 *   miss: a caller deciding whether a place may be shown must check it.
 * - `unplaced`: anything else (a family or kingdom, an unknown match type).
 *   Not a miss either.
 */
export type GbifMatchOutcome =
  | { kind: 'match'; taxon: NormalizedTaxon }
  | { kind: 'none' }
  | { kind: 'uncertain'; uncertain: UncertainMatch }
  | { kind: 'unplaced' }

// The `gbif-match` cache value. Never a cache miss: before the outcomes were
// told apart a miss meant NONE or "placed above a genus", so those rows are
// left behind under the old, unversioned keys.
type CachedMatch =
  | { match: NormalizedTaxon }
  | { none: true }
  | { uncertain: UncertainMatch }
  | { unplaced: true }

const MATCH_CACHE_VERSION = 'm2'
// s3: the outcome carries `exhaustive` and `exactTaxonKeys`. An s2 row has
// neither, and its exact hits were read from a cut-down name list.
const SEARCH_CACHE_VERSION = 's3'

/**
 * A `species/search` answer, with what it proves about the name asked for.
 */
export interface GbifSearchOutcome {
  results: GbifTaxonSearchResult[]
  // False when GBIF answered results this code could not read (or more than
  // it asked for): the one it skipped may have been the name asked for.
  complete: boolean
  // True only when GBIF said this page is all there is (`endOfRecords`). The
  // search is ranked full text, so a page that is not the last one says
  // nothing about the species the name belongs to ("tiger" has 1556 results,
  // and Panthera tigris is not in the first 400).
  exhaustive: boolean
  // The keys of the results whose scientific name, or any one of all their
  // vernacular names (not only the ones kept for display), is the query.
  exactTaxonKeys: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// A key in a cache row: null, a usage key, or undefined for anything else.
const toCachedKey = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null
  return typeof value === 'string' && /^\d{1,12}$/.test(value)
    ? value
    : undefined
}

// A cache row is data from an older or other process: read it as strictly as
// a live answer, and fail on anything else.
const toMatchOutcome = (cached: unknown): GbifMatchOutcome => {
  if (isRecord(cached)) {
    if (isRecord(cached.match) && typeof cached.match.taxonKey === 'string') {
      return {
        kind: 'match',
        taxon: cached.match as unknown as NormalizedTaxon
      }
    }
    if (cached.none === true) return { kind: 'none' }
    if (isRecord(cached.uncertain)) {
      const speciesKey = toCachedKey(cached.uncertain.speciesKey)
      const genusKey = toCachedKey(cached.uncertain.genusKey)
      if (
        speciesKey !== undefined &&
        genusKey !== undefined &&
        (speciesKey || genusKey)
      ) {
        return { kind: 'uncertain', uncertain: { speciesKey, genusKey } }
      }
    }
    if (cached.unplaced === true) return { kind: 'unplaced' }
  }
  throw new LookupError('parse', 'Unreadable cached GBIF match')
}

const toSearchOutcome = (cached: unknown): GbifSearchOutcome => {
  if (
    isRecord(cached) &&
    Array.isArray(cached.results) &&
    typeof cached.complete === 'boolean' &&
    typeof cached.exhaustive === 'boolean' &&
    Array.isArray(cached.exactTaxonKeys) &&
    cached.exactTaxonKeys.every(
      (key) => typeof key === 'string' && /^\d{1,12}$/.test(key)
    )
  ) {
    return {
      results: cached.results as GbifTaxonSearchResult[],
      complete: cached.complete,
      exhaustive: cached.exhaustive,
      exactTaxonKeys: cached.exactTaxonKeys as string[]
    }
  }
  throw new LookupError('parse', 'Unreadable cached GBIF search')
}

export interface GbifClient {
  /**
   * The accepted taxon GBIF matches `name` to, or null when there is no
   * confident match (EXACT or FUZZY, confidence of at least 90, species or
   * lower; genus and family with `allowHigherRank`). A synonym comes back as
   * the name it is accepted as. Cached as `gbif-match`.
   */
  matchTaxon(
    name: string,
    options?: GbifMatchOptions
  ): Promise<NormalizedTaxon | null>
  /**
   * `matchTaxon` with every outcome told apart. Same cache row. Null only for
   * an empty name, which asks nothing.
   */
  lookupMatch(
    name: string,
    options?: GbifMatchOptions
  ): Promise<GbifMatchOutcome | null>
  /** One taxon by usage key, with its IUCN category. Cached as `gbif-taxon`. */
  getTaxon(key: string): Promise<GbifTaxon | null>
  /** The IUCN Red List category for a usage key, or null. Not cached alone. */
  getIucnCategory(key: string): Promise<IucnCategory | null>
  /**
   * Up to 10 accepted species whose scientific or common name matches `q`
   * (2 to 100 characters), for the species picker. Cached as `gbif-search`.
   */
  searchTaxa(q: string): Promise<GbifTaxonSearchResult[]>
  /**
   * `searchTaxa` with whether every result was readable, whether GBIF has no
   * more, and which results name `q` exactly. Same cache row. Null for a
   * query too short to ask.
   */
  lookupSearch(q: string): Promise<GbifSearchOutcome | null>
}

// Cache keys are normalized so "Common  Kingfisher" and "common kingfisher"
// share a row, and bounded so they fit the 255 character key column.
const normalizeKeyPart = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()

// Whether two names are the same name: case, spacing and Unicode composition
// aside ("เสือโคร่ง" typed and served in different normal forms).
const sameName = (a: string, b: string) =>
  normalizeKeyPart(a.normalize('NFC')) === normalizeKeyPart(b.normalize('NFC'))

// Answers cached under one endpoint are not answers from another: an admin who
// fixes a wrong endpoint must not be served what the wrong one said. The
// default endpoint keeps unprefixed keys; any other gets a short tag of its own.
const endpointKeyPrefix = (baseUrl: string) =>
  baseUrl === DEFAULT_GBIF_ENDPOINT
    ? ''
    : `@${getHashFromString(baseUrl).slice(0, 12)}|`

// `species/{key}` answers 404 with GBIF's own JSON error for a key it does not
// know: `{"status":404,"message":"Entity not found for uri: …"}`. Any other
// 404 (the HTML page a wrong or retired endpoint answers, say) is a failure.
const isUnknownKeyAnswer: IsEmptyAnswer = ({ statusCode, body }) => {
  if (statusCode !== 404) return false
  try {
    const json = JSON.parse(body) as { message?: unknown } | null
    return typeof json?.message === 'string' && /not found/i.test(json.message)
  } catch {
    return false
  }
}

// `iucnRedListCategory` answers 204 for a taxon with no assessment. A 404 there
// is never "not assessed": it would read as NE and clear the place.
const isNotAssessedAnswer: IsEmptyAnswer = ({ statusCode }) =>
  statusCode === 204

export interface GbifClientDeps {
  database: Database
  // Injected in tests.
  fetch?: LookupFetch
  provider?: LookupProvider
  endpoint?: string
  // The owner's Retry: ask again rather than answer a remembered failure.
  skipCachedErrors?: boolean
}

export const createGbifClient = ({
  database,
  fetch,
  provider = gbifProvider,
  endpoint,
  skipCachedErrors = false
}: GbifClientDeps): GbifClient => {
  const baseUrl = () =>
    (endpoint ?? getConfig().gallery.gbif.endpoint).replace(/\/+$/, '')

  // `species/match` and `species/search` declare no empty answer: they answer
  // 200 for every real query, a no-match included, so any other status is a
  // broken endpoint, not "nothing found".
  const get = async (
    path: string,
    params?: Record<string, string>,
    isEmptyAnswer?: IsEmptyAnswer
  ) => {
    const url = new URL(`${baseUrl()}/${path}`)
    for (const [name, value] of Object.entries(params ?? {})) {
      url.searchParams.set(name, value)
    }
    return lookupGet({ provider, url: url.toString(), fetch, isEmptyAnswer })
  }
  const cacheKey = (key: string) =>
    `${endpointKeyPrefix(baseUrl())}${key}`.slice(0, 255)

  // Unwraps a cache result: a value, null for "nothing", a throw for a failure
  // (so a job can record `failed`).
  const unwrap = <T>(
    result: Awaited<ReturnType<typeof readThroughLookupCache<T>>>
  ): T | null => {
    if (result.status === 'ok') return result.value
    if (result.status === 'miss') return null
    if (result.error instanceof LookupError) throw result.error
    throw new LookupError('unavailable', 'GBIF lookup failed recently')
  }

  // Null only when GBIF answers that it has no assessment (204). A 200 whose
  // category cannot be read, and any other status, throws, so the job records
  // `failed` and the place stays hidden: "unreadable" must never pass for
  // "not threatened".
  const fetchIucn = async (key: string): Promise<IucnCategory | null> => {
    const response = await get(
      `species/${encodeURIComponent(key)}/iucnRedListCategory`,
      undefined,
      isNotAssessedAnswer
    )
    if (response.status !== 'ok') return null
    const category = normalizeIucnCategory(response.json)
    if (category === null) {
      throw new LookupError(
        'parse',
        'GBIF returned an unreadable IUCN category'
      )
    }
    return category
  }

  const client: GbifClient = {
    async matchTaxon(name, options = {}) {
      const outcome = await client.lookupMatch(name, options)
      return outcome?.kind === 'match' ? outcome.taxon : null
    },

    async lookupMatch(name, options = {}) {
      const trimmed = name.trim().slice(0, 255)
      if (!trimmed) return null
      const kingdom = options.kingdom?.trim() || undefined
      const key = cacheKey(
        [
          MATCH_CACHE_VERSION,
          normalizeKeyPart(trimmed),
          kingdom ? normalizeKeyPart(kingdom) : '',
          options.allowHigherRank ? 'group' : ''
        ]
          .filter(Boolean)
          .join('|')
      )

      const cached = unwrap(
        await readThroughLookupCache<CachedMatch>({
          database,
          skipCachedError: skipCachedErrors,
          kind: 'gbif-match',
          key,
          fetcher: async (): Promise<CachedMatch> => {
            const response = await get('species/match', {
              name: trimmed,
              ...(kingdom ? { kingdom } : {}),
              strict: 'false'
            })
            if (response.status !== 'ok') {
              throw new LookupError('http', 'GBIF match gave no answer')
            }
            const outcome = classifyMatch(response.json, {
              allowHigherRank: options.allowHigherRank
            })
            // An answer in a shape this code does not know is a failure.
            if (outcome.kind === 'unreadable') {
              throw new LookupError(
                'parse',
                'GBIF returned an unreadable match'
              )
            }
            if (outcome.kind === 'none') return { none: true }
            if (outcome.kind === 'unplaced') return { unplaced: true }
            if (outcome.kind === 'uncertain') {
              return { uncertain: outcome.uncertain }
            }

            const { synonym, ...taxon } = outcome.match
            if (!synonym) return { match: taxon }

            // The answer describes the synonym; read the accepted taxon for
            // its own name and rank. Without it, keep the accepted key and
            // the classification, which is already the accepted taxon's.
            const accepted = await client
              .getTaxon(taxon.taxonKey)
              .catch(() => null)
            return {
              match: accepted
                ? {
                    taxonKey: accepted.taxonKey,
                    scientificName: accepted.scientificName,
                    rank: accepted.rank,
                    taxonPath: accepted.taxonPath,
                    category: accepted.category
                  }
                : taxon
            }
          }
        })
      )
      if (cached === null) {
        throw new LookupError('parse', 'GBIF match was cached as a miss')
      }
      return toMatchOutcome(cached)
    },

    async getTaxon(key) {
      if (!/^\d{1,12}$/.test(key)) return null

      return unwrap(
        await readThroughLookupCache<GbifTaxon>({
          database,
          skipCachedError: skipCachedErrors,
          // A key GBIF did not know records the subject `failed`; the owner's
          // Retry asks again rather than waiting out the week-long miss.
          skipCachedMiss: skipCachedErrors,
          kind: 'gbif-taxon',
          key: cacheKey(key),
          fetcher: async () => {
            const response = await get(
              `species/${key}`,
              undefined,
              isUnknownKeyAnswer
            )
            if (response.status !== 'ok') return null
            const taxon = normalizeTaxonRecord(response.json)
            if (!taxon) {
              throw new LookupError(
                'parse',
                'GBIF returned an unreadable taxon'
              )
            }

            // A synonym key answers with the accepted key; follow it once.
            const acceptedKey = (response.json as { acceptedKey?: unknown })
              .acceptedKey
            if (
              typeof acceptedKey === 'number' &&
              String(acceptedKey) !== key
            ) {
              return client.getTaxon(String(acceptedKey))
            }

            let iucnCategory = await fetchIucn(taxon.taxonKey)
            // A subspecies is rarely assessed on its own; its species is.
            const speciesKey = (response.json as { speciesKey?: unknown })
              .speciesKey
            if (
              iucnCategory === null &&
              typeof speciesKey === 'number' &&
              String(speciesKey) !== taxon.taxonKey
            ) {
              iucnCategory = await fetchIucn(String(speciesKey))
            }

            const vernacular = (response.json as { vernacularName?: unknown })
              .vernacularName
            return {
              ...taxon,
              vernacularName:
                typeof vernacular === 'string' && vernacular.trim()
                  ? vernacular.trim().slice(0, 255)
                  : null,
              iucnCategory
            }
          }
        })
      )
    },

    async getIucnCategory(key) {
      if (!/^\d{1,12}$/.test(key)) return null
      return fetchIucn(key)
    },

    async searchTaxa(q) {
      return (await client.lookupSearch(q))?.results ?? []
    },

    async lookupSearch(q) {
      const query = q.trim().slice(0, MAX_SEARCH_QUERY_LENGTH)
      if (query.length < 2) return null

      const result = await readThroughLookupCache<GbifSearchOutcome>({
        database,
        skipCachedError: skipCachedErrors,
        kind: 'gbif-search',
        key: cacheKey(`${SEARCH_CACHE_VERSION}|${normalizeKeyPart(query)}`),
        fetcher: async () => {
          const response = await get('species/search', {
            q: query,
            datasetKey: GBIF_BACKBONE_DATASET_KEY,
            rank: 'SPECIES',
            status: 'ACCEPTED',
            limit: String(MAX_SEARCH_RESULTS)
          })
          if (response.status !== 'ok') {
            throw new LookupError('http', 'GBIF search gave no answer')
          }
          const json = response.json as {
            results?: unknown
            endOfRecords?: unknown
          } | null
          const results = json?.results
          if (!Array.isArray(results)) {
            throw new LookupError('parse', 'GBIF returned an unreadable search')
          }

          const found: GbifTaxonSearchResult[] = []
          const exact = new Set<string>()
          let unreadable = 0
          for (const raw of results) {
            if (found.length >= MAX_SEARCH_RESULTS) break
            const taxon = normalizeTaxonRecord(raw)
            if (!taxon) {
              unreadable += 1
              continue
            }
            const names = toVernacularNames(raw)
            found.push({
              ...taxon,
              vernacularName: names.preferred,
              vernacularNames: names.all.slice(0, MAX_VERNACULAR_NAMES)
            })
            if (
              sameName(taxon.scientificName, query) ||
              names.all.some((name) => sameName(name, query))
            ) {
              exact.add(taxon.taxonKey)
            }
          }
          // Results that all fail to read are a changed shape, not "nothing
          // found": a common-name subject would otherwise be cleared.
          if (results.length > 0 && found.length === 0) {
            throw new LookupError('parse', 'GBIF returned unreadable results')
          }
          return {
            results: found,
            complete: unreadable === 0 && found.length === results.length,
            exhaustive: json?.endOfRecords === true,
            exactTaxonKeys: [...exact]
          }
        }
      })
      const cached = unwrap(result)
      if (cached === null) return null
      const outcome = toSearchOutcome(cached)
      // A cut query is not the name asked for: nothing names that exactly.
      return q.trim().length > MAX_SEARCH_QUERY_LENGTH
        ? { ...outcome, exactTaxonKeys: [] }
        : outcome
    }
  }

  return client
}

const toVernacularNames = (
  raw: unknown
): { preferred: string | null; all: string[] } => {
  const list = (raw as { vernacularNames?: unknown }).vernacularNames
  if (!Array.isArray(list)) return { preferred: null, all: [] }

  const names: { name: string; english: boolean }[] = []
  for (const entry of list) {
    const name = (entry as { vernacularName?: unknown })?.vernacularName
    if (typeof name !== 'string' || !name.trim()) continue
    const language = (entry as { language?: unknown }).language
    names.push({
      name: name.trim().slice(0, 255),
      english: language === 'eng'
    })
  }

  const seen = new Set<string>()
  const unique = names.filter(({ name }) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => Number(b.english) - Number(a.english))

  // Every name, English first. The caller keeps the first few for display
  // and matches against all of them.
  return {
    preferred: unique[0]?.name ?? null,
    all: unique.map(({ name }) => name)
  }
}
