import {
  GALLERY_LOOKUP_OUTCOMES,
  type GalleryLookupEntry,
  type GalleryLookupOutcome,
  type GetGalleryLookupParams,
  MAX_GALLERY_LOOKUP_KEY_LENGTH,
  MAX_GALLERY_LOOKUP_KIND_LENGTH,
  type PruneGalleryLookupsParams,
  type PutGalleryLookupParams
} from '@/lib/database/domains/gallery/types'
import type { Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray } from '@/lib/database/sql/utils/knex'

// `gallery_lookup_cache`, the read-through cache of GBIF and Nominatim answers
// the gallery lookups share (see GalleryLookupCacheDatabase in ./types.ts).

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

export const getGalleryLookup = async (
  db: Db,
  { kind, key, now = Date.now() }: GetGalleryLookupParams
): Promise<GalleryLookupEntry | null> => {
  if (!isValidKey(kind, key)) return null
  const row = await db
    .selectFrom('gallery_lookup_cache')
    .selectAll()
    .where('kind', '=', kind)
    .where('key', '=', key)
    .limit(1)
    .executeTakeFirst()
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
}

export const putGalleryLookup = async (
  db: Db,
  { kind, key, outcome, value, ttlMs, now }: PutGalleryLookupParams
): Promise<void> => {
  if (!isValidKey(kind, key)) return
  if (!(GALLERY_LOOKUP_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(`Unknown gallery lookup outcome: ${outcome}`)
  }
  const fetchedAt = now ?? Date.now()
  const ttl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0

  // A single upsert, so two lookups of the same key racing both succeed
  // and the last answer wins.
  await db
    .insertInto('gallery_lookup_cache')
    .values({
      kind,
      key,
      outcome,
      value:
        value === undefined || value === null ? null : JSON.stringify(value),
      fetchedAt: new Date(fetchedAt),
      expiresAt: new Date(fetchedAt + ttl)
    })
    .onConflict((oc) =>
      oc.columns(['kind', 'key']).doUpdateSet((eb) => ({
        outcome: eb.ref('excluded.outcome'),
        value: eb.ref('excluded.value'),
        fetchedAt: eb.ref('excluded.fetchedAt'),
        expiresAt: eb.ref('excluded.expiresAt')
      }))
    )
    .execute()
}

export const pruneGalleryLookups = async (
  db: Db,
  { before, limit }: PruneGalleryLookupsParams
): Promise<number> => {
  const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (size === 0) return 0

  const rows = await db
    .selectFrom('gallery_lookup_cache')
    .select(['kind', 'key'])
    .where('expiresAt', '<', timestampValue(before))
    .orderBy('expiresAt', 'asc')
    .limit(size)
    .execute()
  if (rows.length === 0) return 0

  let deleted = 0
  // Two bindings per row.
  const batchSize = Math.max(1, Math.floor(getWhereInBatchSize(db, 2) / 2))
  for (const chunk of chunkArray(rows, batchSize)) {
    const result = await db
      .deleteFrom('gallery_lookup_cache')
      .where((eb) =>
        eb(
          eb.refTuple('kind', 'key'),
          'in',
          chunk.map((row) => eb.tuple(row.kind, row.key))
        )
      )
      .where('expiresAt', '<', timestampValue(before))
      .executeTakeFirst()
    deleted += Number(result.numDeletedRows)
  }
  return deleted
}
