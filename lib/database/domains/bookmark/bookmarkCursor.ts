// Bookmarks page by a `(createdAt, id)` keyset, and `createdAt` does not follow
// `id` order (imports set it), so a cursor has to carry both values. Mastodon
// treats `max_id`/`min_id`/`since_id` as opaque, so the pair is encoded into a
// single base64url token, as favourites are. A cursor that carries its own
// keyset needs no lookup, so deleting the bookmark it names cannot end the
// list.
//
// A bare numeric id — the cursor older `Link` headers and clients still send —
// is accepted too. It names a row but not its position, so the query has to
// read that row's `createdAt`; a row that is gone leaves nothing to page from.

export interface BookmarkCursor {
  // Null for a legacy numeric-id cursor, which the query resolves by lookup.
  createdAt: number | null
  id: number
}

export interface BookmarkKeyset {
  createdAt: number
  id: number
}

export const encodeBookmarkCursor = ({
  createdAt,
  id
}: BookmarkKeyset): string =>
  Buffer.from(`${createdAt}:${id}`, 'utf8').toString('base64url')

/** The cursor of a bookmark row, for the next or previous page. */
export const toBookmarkCursor = (bookmark: {
  createdAt: number
  id: string
}): string =>
  encodeBookmarkCursor({
    createdAt: bookmark.createdAt,
    id: Number(bookmark.id)
  })

const COMPOSITE_PATTERN = /^(\d+):(\d+)$/
const LEGACY_ID_PATTERN = /^\d+$/

export const decodeBookmarkCursor = (
  cursor?: string | null
): BookmarkCursor | null => {
  if (!cursor) return null

  const composite = COMPOSITE_PATTERN.exec(
    Buffer.from(cursor, 'base64url').toString('utf8')
  )
  if (composite) {
    const createdAt = Number(composite[1])
    const id = Number(composite[2])
    return Number.isSafeInteger(createdAt) &&
      createdAt >= 0 &&
      Number.isSafeInteger(id) &&
      id > 0
      ? { createdAt, id }
      : null
  }

  // A digit-only base64url string never decodes to `digits:digits` — its first
  // byte would be at least 0xD0 — so the legacy form cannot be mistaken for a
  // composite one.
  if (!LEGACY_ID_PATTERN.test(cursor)) return null
  const id = Number(cursor)
  return Number.isSafeInteger(id) ? { createdAt: null, id } : null
}
