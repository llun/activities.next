// `favourited_by` paginates the actors who favourited a single status. The
// `likes` table has a composite primary key `(statusId, actorId)` and no
// surrogate id, so — for a fixed status — the page cursor is the `(createdAt,
// actorId)` pair of a like row. Mastodon treats `max_id`/`min_id` as opaque, so
// the pair is encoded into a single base64url token rather than exposing the
// raw values. (This is the fixed-status/varying-actor counterpart of
// `favouriteCursor`, which is fixed-actor/varying-status.)

export interface FavouritedByCursor {
  createdAt: number
  actorId: string
}

export const encodeFavouritedByCursor = ({
  createdAt,
  actorId
}: FavouritedByCursor): string =>
  Buffer.from(`${createdAt}:${actorId}`, 'utf8').toString('base64url')

export const decodeFavouritedByCursor = (
  cursor?: string | null
): FavouritedByCursor | null => {
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
  const actorId = decoded.slice(separatorIndex + 1)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !actorId) {
    return null
  }

  return { createdAt, actorId }
}
