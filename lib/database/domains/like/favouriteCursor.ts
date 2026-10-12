// The `likes` table has a composite primary key `(statusId, actorId)` and no
// surrogate id, so favourites are paginated by a composite `(createdAt,
// statusId)` cursor. Mastodon treats `max_id`/`min_id` as opaque, so we encode
// the pair into a single base64url token rather than exposing the raw values.

export interface FavouriteCursor {
  createdAt: number
  statusId: string
}

export const encodeFavouriteCursor = ({
  createdAt,
  statusId
}: FavouriteCursor): string =>
  Buffer.from(`${createdAt}:${statusId}`, 'utf8').toString('base64url')

export const decodeFavouriteCursor = (
  cursor?: string | null
): FavouriteCursor | null => {
  if (!cursor) return null

  let decoded: string
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex <= 0) return null

  const createdAt = Number(decoded.slice(0, separatorIndex))
  const statusId = decoded.slice(separatorIndex + 1)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !statusId) {
    return null
  }

  return { createdAt, statusId }
}
