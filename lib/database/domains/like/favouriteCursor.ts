// The `likes` table has a composite primary key `(statusId, actorId)` and no
// surrogate id, so favourites are paginated by a composite `(createdAt,
// statusId)` cursor. Mastodon treats `max_id`/`min_id` as opaque, so we encode
// the pair into a single base64url token rather than exposing the raw values.

// The largest millisecond value a Date can hold (ECMAScript's time range).
// Past it `new Date()` is Invalid and the query binding throws, so a crafted
// cursor would fail the request instead of returning an empty page.
const MAX_DATE_MS = 8.64e15
// Status ids are URLs: a control character (NUL above all, which PostgreSQL
// refuses in a text parameter) can only come from a crafted cursor.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

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
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    createdAt > MAX_DATE_MS ||
    !statusId ||
    CONTROL_CHARACTER.test(statusId)
  ) {
    return null
  }

  return { createdAt, statusId }
}
