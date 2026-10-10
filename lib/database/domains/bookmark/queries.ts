import type { ExpressionBuilder } from 'kysely'

import type {
  CreateBookmarkParams,
  DeleteBookmarkParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams
} from '@/lib/database/domains/bookmark/types'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { Bookmark } from '@/lib/types/domain/bookmark'
import { StatusType } from '@/lib/types/domain/status'

export const getOriginalStatusIdFromAnnounceContent = (content: unknown) => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'string') return parsed
      if (parsed && typeof parsed.url === 'string') return parsed.url
      if (parsed && typeof parsed.id === 'string') return parsed.id
      return null
    } catch {
      return content
    }
  }
  if (typeof content === 'object') {
    if ('url' in content && typeof content.url === 'string') return content.url
    if ('id' in content && typeof content.id === 'string') return content.id
  }
  return null
}

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10
const BOOKMARK_CURSOR_ID_PATTERN = /^\d+$/

// Bookmark ids are bigints read back as safe integers, so a longer digit string
// names no bookmark (and PostgreSQL rejects one past the int8 range).
const isBookmarkCursorId = (id: string) =>
  BOOKMARK_CURSOR_ID_PATTERN.test(id) && Number.isSafeInteger(Number(id))

const resolveBookmarkStatusId = async (
  db: Db,
  {
    statusId,
    statusType,
    depth = 0
  }: {
    statusId: string
    statusType?: StatusType
    depth?: number
  }
): Promise<string | null> => {
  if (depth > MAX_ANNOUNCE_RESOLUTION_DEPTH) return statusId
  if (statusType && statusType !== StatusType.enum.Announce) return statusId

  const status = await db
    .selectFrom('statuses')
    .select(['id', 'type', 'originalStatusId', 'content'])
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  if (!status) return null

  if (status.type !== StatusType.enum.Announce) return status.id

  const originalStatusId =
    status.originalStatusId ||
    getOriginalStatusIdFromAnnounceContent(status.content)
  if (!originalStatusId || originalStatusId === status.id) return status.id

  return (
    (await resolveBookmarkStatusId(db, {
      statusId: originalStatusId,
      depth: depth + 1
    })) ?? originalStatusId
  )
}

// A bookmark matches a status by the (announce-resolved) status it stores or by
// the status it was originally created through.
const matchesBookmarkStatus = (
  eb: ExpressionBuilder<DB, 'bookmarks'>,
  { statusId, bookmarkStatusId }: { statusId: string; bookmarkStatusId: string }
) =>
  eb.or([
    eb('statusId', '=', bookmarkStatusId),
    eb('sourceStatusId', '=', statusId)
  ])

export const createBookmark = async (
  db: Db,
  { actorId, statusId }: CreateBookmarkParams
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    const bookmarkStatusId = await resolveBookmarkStatusId(trx, { statusId })
    if (!bookmarkStatusId) return

    const existing = await trx
      .selectFrom('bookmarks')
      .select(['id', 'sourceStatusId'])
      .where('actorId', '=', actorId)
      .where('statusId', '=', bookmarkStatusId)
      .limit(1)
      .executeTakeFirst()

    const currentTime = new Date()
    const sourceStatusId = statusId === bookmarkStatusId ? null : statusId
    if (existing) {
      if (sourceStatusId && existing.sourceStatusId !== sourceStatusId) {
        await trx
          .updateTable('bookmarks')
          .set({ sourceStatusId, updatedAt: currentTime })
          .where('id', '=', existing.id)
          .execute()
      }
      return
    }

    // A concurrent request may have inserted the same bookmark since the
    // read: that one wins, and bookmarking stays idempotent.
    await trx
      .insertInto('bookmarks')
      .values({
        actorId,
        statusId: bookmarkStatusId,
        sourceStatusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) => oc.columns(['actorId', 'statusId']).doNothing())
      .execute()
  })
}

export const deleteBookmark = (
  db: Db,
  { actorId, statusId }: DeleteBookmarkParams
): Promise<void> =>
  inTransaction(db, async (trx) => {
    const bookmarkStatusId =
      (await resolveBookmarkStatusId(trx, { statusId })) ?? statusId
    await trx
      .deleteFrom('bookmarks')
      .where('actorId', '=', actorId)
      .where((eb) => matchesBookmarkStatus(eb, { statusId, bookmarkStatusId }))
      .execute()
  })

export const isActorBookmarkedStatus = async (
  db: Db,
  { actorId, statusId, statusType }: IsActorBookmarkedStatusParams
): Promise<boolean> => {
  const bookmarkStatusId =
    (await resolveBookmarkStatusId(db, { statusId, statusType })) ?? statusId
  const bookmark = await db
    .selectFrom('bookmarks')
    .select('id')
    .where('actorId', '=', actorId)
    .where((eb) => matchesBookmarkStatus(eb, { statusId, bookmarkStatusId }))
    .limit(1)
    .executeTakeFirst()
  return Boolean(bookmark)
}

export const getBookmarks = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetBookmarksParams
): Promise<Bookmark[]> => {
  const olderCursorId = maxId
  const newerCursorId = minId || sinceId

  if (
    (olderCursorId && !isBookmarkCursorId(olderCursorId)) ||
    (newerCursorId && !isBookmarkCursorId(newerCursorId))
  )
    return []

  let query = db
    .selectFrom('bookmarks')
    .selectAll()
    .where('actorId', '=', actorId)

  for (const [cursorId, operator] of [
    [olderCursorId, '<'],
    [newerCursorId, '>']
  ] as const) {
    if (!cursorId) continue
    const cursor = await db
      .selectFrom('bookmarks')
      .select(['id', 'createdAt'])
      .where('actorId', '=', actorId)
      .where('id', '=', Number(cursorId))
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt: cursor.createdAt ?? 0, tieBreaker: cursor.id },
        operator,
        'id'
      )
    )
  }

  const direction = minId ? 'asc' : 'desc'
  const bookmarks = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .limit(limit)
    .execute()
  return (minId ? bookmarks.reverse() : bookmarks).map((row) =>
    // Parsing drops sourceStatusId and turns the integer id into a string.
    Bookmark.parse({ ...row, id: String(row.id) })
  )
}

// The facade getSQLDatabase binds with bindDb().
export const bookmarkQueries = {
  createBookmark,
  deleteBookmark,
  isActorBookmarkedStatus,
  getBookmarks
}
