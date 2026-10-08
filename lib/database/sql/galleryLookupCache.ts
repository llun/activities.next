import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'

// `gallery_lookup_cache`: the read-through cache of GBIF and Nominatim answers
// the gallery lookups share, keyed by (`kind`, `key`). It is not linked to any
// actor, but geocode keys are ~5 km grid cells (`<lang>:<lat2>,<lng2>`), so the
// table is a coarse trace of where photos were taken: prune it, and never
// expose it.

export const GALLERY_LOOKUP_OUTCOMES = ['ok', 'miss', 'error'] as const
export type GalleryLookupOutcome = (typeof GALLERY_LOOKUP_OUTCOMES)[number]

// `kind` is varchar(32) and `key` varchar(255).
export const MAX_GALLERY_LOOKUP_KIND_LENGTH = 32
export const MAX_GALLERY_LOOKUP_KEY_LENGTH = 255

export interface GalleryLookupEntry {
  kind: string
  key: string
  outcome: GalleryLookupOutcome
  // The parsed JSON value; null for a miss or an error, or a corrupt blob.
  value: unknown
  // Epoch milliseconds.
  fetchedAt: number
  expiresAt: number
}

export interface GetGalleryLookupParams {
  kind: string
  key: string
  // Epoch milliseconds the expiry is judged against; defaults to now.
  now?: number
}

export interface PutGalleryLookupParams {
  kind: string
  key: string
  outcome: GalleryLookupOutcome
  // Stored as JSON. Ignored (stored as null) when undefined.
  value?: unknown
  // How long the entry stays fresh.
  ttlMs: number
  // Epoch milliseconds; defaults to now.
  now?: number
}

export interface PruneGalleryLookupsParams {
  // Entries that expired before this epoch-milliseconds time are deleted.
  before: number
  // The most rows one call deletes.
  limit: number
}

export interface GalleryLookupCacheDatabase {
  // The entry, or null when there is none or it has expired.
  getGalleryLookup(
    params: GetGalleryLookupParams
  ): Promise<GalleryLookupEntry | null>
  // Inserts or replaces the entry. A kind or key over its column length is
  // refused (nothing is written) rather than truncated into another key.
  putGalleryLookup(params: PutGalleryLookupParams): Promise<void>
  // Returns the number of rows deleted.
  pruneGalleryLookups(params: PruneGalleryLookupsParams): Promise<number>
}

interface SQLGalleryLookup {
  kind: string
  key: string
  outcome: string
  value: string | null
  fetchedAt: number | string | Date
  expiresAt: number | string | Date
}

const parseValue = (value: string | null): unknown => {
  if (value === null || value === undefined) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const isValidKey = (kind: string, key: string): boolean =>
  kind.length > 0 &&
  kind.length <= MAX_GALLERY_LOOKUP_KIND_LENGTH &&
  key.length > 0 &&
  key.length <= MAX_GALLERY_LOOKUP_KEY_LENGTH

export const GalleryLookupCacheSQLDatabaseMixin = (
  database: Knex
): GalleryLookupCacheDatabase => ({
  async getGalleryLookup({ kind, key, now = Date.now() }) {
    if (!isValidKey(kind, key)) return null
    const row = await database<SQLGalleryLookup>('gallery_lookup_cache')
      .where({ kind, key })
      .first()
    if (!row) return null
    if (!(GALLERY_LOOKUP_OUTCOMES as readonly string[]).includes(row.outcome)) {
      return null
    }

    const expiresAt = getCompatibleTime(row.expiresAt)
    // Expiry is judged on the parsed time, never by comparing SQLite's mixed
    // storage types in SQL.
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null

    return {
      kind: row.kind,
      key: row.key,
      outcome: row.outcome as GalleryLookupOutcome,
      value: parseValue(row.value),
      fetchedAt: getCompatibleTime(row.fetchedAt),
      expiresAt
    }
  },

  async putGalleryLookup({ kind, key, outcome, value, ttlMs, now }) {
    if (!isValidKey(kind, key)) return
    if (!(GALLERY_LOOKUP_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new Error(`Unknown gallery lookup outcome: ${outcome}`)
    }
    const fetchedAt = now ?? Date.now()
    const ttl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0
    const row = {
      kind,
      key,
      outcome,
      value:
        value === undefined || value === null ? null : JSON.stringify(value),
      fetchedAt: new Date(fetchedAt),
      expiresAt: new Date(fetchedAt + ttl)
    }

    // A single upsert, so two lookups of the same key racing both succeed
    // and the last answer wins.
    await database('gallery_lookup_cache')
      .insert(row)
      .onConflict(['kind', 'key'])
      .merge(['outcome', 'value', 'fetchedAt', 'expiresAt'])
  },

  async pruneGalleryLookups({ before, limit }) {
    const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
    if (size === 0) return 0

    const rows = await database<SQLGalleryLookup>('gallery_lookup_cache')
      .where('expiresAt', '<', new Date(before))
      .orderBy('expiresAt', 'asc')
      .limit(size)
      .select('kind', 'key')
    if (rows.length === 0) return 0

    let deleted = 0
    // Two bindings per row.
    const batchSize = Math.max(
      1,
      Math.floor(getWhereInBatchSize(database, 2) / 2)
    )
    for (const chunk of chunkArray(rows, batchSize)) {
      deleted += await database('gallery_lookup_cache')
        .whereIn(
          ['kind', 'key'],
          chunk.map((row) => [row.kind, row.key])
        )
        .where('expiresAt', '<', new Date(before))
        .delete()
    }
    return deleted
  }
})
