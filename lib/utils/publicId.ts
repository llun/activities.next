import { v7 } from 'uuid'

import { urlToId } from '@/lib/utils/urlToId'

// Strict UUIDv7 shape: version nibble pinned to 7 and RFC 4122 variant to
// [89ab], so v4 row ids (notifications, media, …) and legacy encodings can
// never be mistaken for a public id.
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
