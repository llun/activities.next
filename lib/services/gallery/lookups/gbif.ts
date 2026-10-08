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
  NormalizedMatch,
  NormalizedTaxon,
  UncertainMatch,
  getUncertainMatch,
  isReadableMatch,
  normalizeIucnCategory,
  normalizeMatch,
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
const MAX_VERNACULAR_NAMES = 20

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
 * What `species/match` made of a name:
 * - `match`: a confident match (see `matchTaxon`).
 * - `uncertain`: GBIF placed the name in a species or genus, but only as a
 *   HIGHERRANK answer or below the confidence bar. "Pongo abelii xyz" is a
 *   HIGHERRANK answer naming the Sumatran orangutan (CR), so this is NOT a
 *   miss: a caller deciding whether a place may be shown must check it.
 * - null: no species or genus at all (`NONE`, or a family or higher).
 */
export type GbifMatchOutcome =
  | { kind: 'match'; taxon: NormalizedTaxon }
  | { kind: 'uncertain'; uncertain: UncertainMatch }
  | null

// The `gbif-match` cache value: a confident match, or an uncertain one.
type CachedMatch = NormalizedTaxon | { uncertain: UncertainMatch }

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
  /** `matchTaxon` with the uncertain answers kept. Same cache row. */
  lookupMatch(
    name: string,
    options?: GbifMatchOptions
  ): Promise<GbifMatchOutcome>
  /** One taxon by usage key, with its IUCN category. Cached as `gbif-taxon`. */
  getTaxon(key: string): Promise<GbifTaxon | null>
  /** The IUCN Red List category for a usage key, or null. Not cached alone. */
  getIucnCategory(key: string): Promise<IucnCategory | null>
  /**
   * Up to 10 accepted species whose scientific or common name matches `q`
   * (2 to 100 characters), for the species picker. Cached as `gbif-search`.
   */
  searchTaxa(q: string): Promise<GbifTaxonSearchResult[]>
}

// Cache keys are normalized so "Common  Kingfisher" and "common kingfisher"
// share a row, and bounded so they fit the 255 character key column.
const normalizeKeyPart = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()

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
          fetcher: async (): Promise<CachedMatch | null> => {
            const response = await get('species/match', {
              name: trimmed,
              ...(kingdom ? { kingdom } : {}),
              strict: 'false'
            })
            if (response.status !== 'ok') {
              throw new LookupError('http', 'GBIF match gave no answer')
            }
            // A miss is only a readable answer that names no confident match;
            // an answer in a shape this code does not know is a failure.
            if (!isReadableMatch(response.json)) {
              throw new LookupError(
                'parse',
                'GBIF returned an unreadable match'
              )
            }
            const match: NormalizedMatch | null = normalizeMatch(
              response.json,
              { allowHigherRank: options.allowHigherRank }
            )
            if (!match) {
              const uncertain = getUncertainMatch(response.json)
              return uncertain ? { uncertain } : null
            }

            const { synonym, ...taxon } = match
            if (!synonym) return taxon

            // The answer describes the synonym; read the accepted taxon for
            // its own name and rank. Without it, keep the accepted key and
            // the classification, which is already the accepted taxon's.
            const accepted = await client
              .getTaxon(taxon.taxonKey)
              .catch(() => null)
            return accepted
              ? {
                  taxonKey: accepted.taxonKey,
                  scientificName: accepted.scientificName,
                  rank: accepted.rank,
                  taxonPath: accepted.taxonPath,
                  category: accepted.category
                }
              : taxon
          }
        })
      )
      if (cached === null) return null
      if ('uncertain' in cached) {
        return { kind: 'uncertain', uncertain: cached.uncertain }
      }
      return { kind: 'match', taxon: cached }
    },

    async getTaxon(key) {
      if (!/^\d{1,12}$/.test(key)) return null

      return unwrap(
        await readThroughLookupCache<GbifTaxon>({
          database,
          skipCachedError: skipCachedErrors,
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
      const query = q.trim().slice(0, 100)
      if (query.length < 2) return []

      const result = await readThroughLookupCache<GbifTaxonSearchResult[]>({
        database,
        skipCachedError: skipCachedErrors,
        kind: 'gbif-search',
        key: cacheKey(normalizeKeyPart(query)),
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
          const results = (response.json as { results?: unknown } | null)
            ?.results
          if (!Array.isArray(results)) {
            throw new LookupError('parse', 'GBIF returned an unreadable search')
          }

          const found: GbifTaxonSearchResult[] = []
          for (const raw of results) {
            const taxon = normalizeTaxonRecord(raw)
            if (!taxon) continue
            const names = toVernacularNames(raw)
            found.push({
              ...taxon,
              vernacularName: names.preferred,
              vernacularNames: names.all
            })
            if (found.length >= MAX_SEARCH_RESULTS) break
          }
          // Results that all fail to read are a changed shape, not "nothing
          // found": a common-name subject would otherwise be cleared.
          if (results.length > 0 && found.length === 0) {
            throw new LookupError('parse', 'GBIF returned unreadable results')
          }
          return found
        }
      })
      return unwrap(result) ?? []
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

  return {
    preferred: unique[0]?.name ?? null,
    all: unique.slice(0, MAX_VERNACULAR_NAMES).map(({ name }) => name)
  }
}
