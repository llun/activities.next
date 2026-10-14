import { v7 } from 'uuid'

import { urlToId } from '@/lib/utils/urlToId'

// Strict UUIDv7 shape: version nibble pinned to 7 and RFC 4122 variant to
// [89ab], so v4 row ids (media attachments, …) and legacy encodings can never
// be mistaken for a public id. Notification ids are minted with
// generatePublicId too, so they match this shape; they are only ever looked up
// as notification row ids, never through a status/actor resolver.
const PUBLIC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const generatePublicId = (timestamp?: number): string => {
  if (timestamp === undefined) return v7()
  const msecs =
    Number.isFinite(timestamp) && timestamp >= 0 ? Math.floor(timestamp) : 0
  return v7({ msecs })
}

export const isPublicId = (value: string): boolean =>
  PUBLIC_ID_PATTERN.test(value)

// isPublicId accepts either case and generatePublicId only ever mints lowercase,
// so an uppercased publicId is the SAME id — but whether the DATABASE agrees is
// a collation question: SQLite and PostgreSQL compare `publicId = ?` case
// sensitively, MySQL's default utf8mb4_0900_ai_ci does not. Every publicId
// lookup therefore normalizes the PARAMETER through this — never the column,
// which would defeat the unique index — so the same id resolves the same way on
// every backend and at every resolution site.
export const toPublicIdLookupKey = (publicId: string): string =>
  publicId.toLowerCase()

export const getPublicIdTimestamp = (publicId: string): number =>
  parseInt(publicId.slice(0, 8) + publicId.slice(9, 13), 16)

interface ClientIdSource {
  id: string
  publicId?: string | null
}

export const getClientStatusId = (status: ClientIdSource): string =>
  status.publicId ?? urlToId(status.id)

export const getClientActorId = (actor: ClientIdSource): string =>
  actor.publicId ?? urlToId(actor.id)

/**
 * The highest-sorting UUIDv7 for one millisecond: the 48-bit timestamp, then
 * every remaining bit set (version 7, variant `b`). As a notifications marker
 * it reads as "everything created up to and including this millisecond is
 * read", because every notification id minted in that millisecond or earlier
 * (generatePublicId) sorts at or below it, and every later one above it.
 */
export const getMaxTimeOrderedIdForMs = (msecs: number): string => {
  const clamped =
    Number.isFinite(msecs) && msecs >= 0
      ? Math.min(Math.floor(msecs), 0xffffffffffff)
      : 0
  const hex = clamped.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7fff-bfff-ffffffffffff`
}
