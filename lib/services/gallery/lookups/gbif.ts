import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

import { readThroughLookupCache } from './lookupCache'
import {
  LookupError,
  LookupFetch,
  LookupProvider,
  lookupGet
} from './lookupRequest'
import {
  IucnCategory,
  NormalizedMatch,
  NormalizedTaxon,
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

export interface GbifClientDeps {
  database: Database
  // Injected in tests.
  fetch?: LookupFetch
  provider?: LookupProvider
  endpoint?: string
}

export const createGbifClient = ({
  database,
  fetch,
  provider = gbifProvider,
  endpoint
}: GbifClientDeps): GbifClient => {
  const baseUrl = () =>
    (endpoint ?? getConfig().gallery.gbif.endpoint).replace(/\/+$/, '')

  const get = async (path: string, params?: Record<string, string>) => {
    const url = new URL(`${baseUrl()}/${path}`)
    for (const [name, value] of Object.entries(params ?? {})) {
      url.searchParams.set(name, value)
    }
    return lookupGet({ provider, url: url.toString(), fetch })
  }

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

  const fetchIucn = async (key: string): Promise<IucnCategory | null> => {
    const response = await get(
      `species/${encodeURIComponent(key)}/iucnRedListCategory`
    )
    return response.status === 'ok'
      ? normalizeIucnCategory(response.json)
      : null
  }

  const client: GbifClient = {
    async matchTaxon(name, options = {}) {
      const trimmed = name.trim().slice(0, 255)
      if (!trimmed) return null
      const kingdom = options.kingdom?.trim() || undefined
      const key = [
        normalizeKeyPart(trimmed),
        kingdom ? normalizeKeyPart(kingdom) : '',
        options.allowHigherRank ? 'group' : ''
      ]
        .filter(Boolean)
        .join('|')
        .slice(0, 255)

      return unwrap(
        await readThroughLookupCache<NormalizedTaxon>({
          database,
          kind: 'gbif-match',
          key,
          fetcher: async () => {
            const response = await get('species/match', {
              name: trimmed,
              ...(kingdom ? { kingdom } : {}),
              strict: 'false'
            })
            if (response.status !== 'ok') return null
            const match: NormalizedMatch | null = normalizeMatch(
              response.json,
              { allowHigherRank: options.allowHigherRank }
            )
            if (!match) return null

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
    },

    async getTaxon(key) {
      if (!/^\d{1,12}$/.test(key)) return null

      return unwrap(
        await readThroughLookupCache<GbifTaxon>({
          database,
          kind: 'gbif-taxon',
          key,
          fetcher: async () => {
            const response = await get(`species/${key}`)
            if (response.status !== 'ok') return null
            const taxon = normalizeTaxonRecord(response.json)
            if (!taxon) return null

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
        kind: 'gbif-search',
        key: normalizeKeyPart(query),
        fetcher: async () => {
          const response = await get('species/search', {
            q: query,
            datasetKey: GBIF_BACKBONE_DATASET_KEY,
            rank: 'SPECIES',
            status: 'ACCEPTED',
            limit: String(MAX_SEARCH_RESULTS)
          })
          if (response.status !== 'ok') return []
          const results = (response.json as { results?: unknown }).results
          if (!Array.isArray(results)) return []

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
