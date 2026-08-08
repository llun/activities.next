import { toPublicIdLookupKey } from '@/lib/utils/publicId'

import { chunkArray } from './knex'

interface PublicIdRow {
  id: string
  publicId: string
}

interface ResolveIdsByPublicIdsParams {
  publicIds: string[]
  batchSize: number
  selectChunk: (lookupKeys: string[]) => Promise<PublicIdRow[]>
}

/**
 * Shared body of the batch publicId → stored-id lookups (statuses and actors).
 *
 * Queries with NORMALIZED lookup keys — the parameter only, never the column, so
 * the unique index on `publicId` is still used — and returns a map keyed by the
 * publicId strings the CALLER asked with, not by the ones the database happened
 * to return. Those differ under a case-insensitive collation (MySQL answers a
 * lowercase request with the stored uppercase value), and a caller zipping the
 * map back against its own input would silently miss the row. Chunked because
 * SQLite caps a statement at SQLITE_MAX_BINDINGS parameters.
 */
interface ResolvePublicIdsByIdsParams {
  ids: string[]
  batchSize: number
  selectChunk: (ids: string[]) => Promise<PublicIdRow[]>
}

/**
 * Shared body of the batch stored-id → publicId lookups (statuses and actors) —
 * the emission-side counterpart of resolveIdsByPublicIds.
 *
 * Stored ids are ActivityPub URIs, compared verbatim (no case folding: URIs are
 * the join key everywhere and are never normalized), so the returned map is
 * simply keyed by the stored id. Chunked for the same reason as its sibling: a
 * timeline page can carry more ids than SQLITE_MAX_BINDINGS allows in a single
 * statement, and every emission site now feeds these with full pages.
 */
export const resolvePublicIdsByIds = async ({
  ids,
  batchSize,
  selectChunk
}: ResolvePublicIdsByIdsParams): Promise<Map<string, string>> => {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  const resolved = new Map<string, string>()
  if (uniqueIds.length === 0) return resolved

  const rowChunks = await Promise.all(
    chunkArray(uniqueIds, batchSize).map(selectChunk)
  )
  for (const row of rowChunks.flat()) {
    resolved.set(row.id, row.publicId)
  }
  return resolved
}

export const resolveIdsByPublicIds = async ({
  publicIds,
  batchSize,
  selectChunk
}: ResolveIdsByPublicIdsParams): Promise<Map<string, string>> => {
  const requestedByLookupKey = new Map<string, string[]>()
  for (const publicId of publicIds) {
    if (!publicId) continue
    const lookupKey = toPublicIdLookupKey(publicId)
    const requested = requestedByLookupKey.get(lookupKey)
    if (!requested) requestedByLookupKey.set(lookupKey, [publicId])
    else if (!requested.includes(publicId)) requested.push(publicId)
  }

  const resolved = new Map<string, string>()
  if (requestedByLookupKey.size === 0) return resolved

  const rowChunks = await Promise.all(
    chunkArray([...requestedByLookupKey.keys()], batchSize).map(selectChunk)
  )
  for (const row of rowChunks.flat()) {
    const requested =
      requestedByLookupKey.get(toPublicIdLookupKey(row.publicId)) ?? []
    for (const publicId of requested) {
      resolved.set(publicId, row.id)
    }
  }
  return resolved
}
