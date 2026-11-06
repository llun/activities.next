import { toBookmarkCursor } from '@/lib/database/domains/bookmark/bookmarkCursor'
import type { Database } from '@/lib/database/types'
import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Bookmark } from '@/lib/types/domain/bookmark'
import type { Status } from '@/lib/types/domain/status'

export const MAX_BOOKMARK_BACKFILL_ITERATIONS = 5

interface GetBookmarkedStatusesPageParams {
  database: Database
  actorId: string
  currentActor: Actor
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
  /** One folder's bookmarks; null is the unfiled ones, undefined all. */
  folderId?: string | null
}

interface BookmarkedStatusesPage {
  statuses: Status[]
  nextMaxBookmarkId: string | null
  prevMinBookmarkId: string | null
}

export const getBookmarkedStatusesPage = async ({
  database,
  actorId,
  currentActor,
  limit,
  maxId,
  minId,
  sinceId,
  folderId
}: GetBookmarkedStatusesPageParams): Promise<BookmarkedStatusesPage> => {
  const entries: Array<{ bookmark: Bookmark; status: Status }> = []
  let cursor = maxId ?? null
  let iterations = 0
  let lastScannedBookmarkCursor: string | null = null
  let exhausted = false

  while (
    entries.length < limit &&
    iterations < MAX_BOOKMARK_BACKFILL_ITERATIONS
  ) {
    iterations++
    const bookmarks = await database.getBookmarks({
      actorId,
      limit,
      maxId: cursor,
      minId,
      sinceId,
      folderId
    })
    if (bookmarks.length === 0) {
      exhausted = true
      break
    }

    const statuses = await database.getStatusesByIds({
      statusIds: bookmarks.map((bookmark) => bookmark.statusId),
      currentActorId: actorId,
      visibleToActorId: currentActor.id,
      withReplies: false
    })
    const statusMap = new Map<string, Status>(
      statuses.map((status) => [status.id, status])
    )
    const orderedEntries = bookmarks
      .map((bookmark) => {
        const status = statusMap.get(bookmark.statusId)
        return status ? { bookmark, status } : null
      })
      .filter((entry): entry is { bookmark: Bookmark; status: Status } =>
        Boolean(entry)
      )
    const readableStatuses = await filterReadableStatuses({
      database,
      statuses: orderedEntries.map((entry) => entry.status),
      currentActor
    })
    const readableStatusIds = new Set(
      readableStatuses.map((status) => status.id)
    )
    entries.push(
      ...orderedEntries.filter((entry) =>
        readableStatusIds.has(entry.status.id)
      )
    )

    cursor = toBookmarkCursor(bookmarks[bookmarks.length - 1])
    lastScannedBookmarkCursor = cursor

    if (bookmarks.length < limit) {
      exhausted = true
      break
    }
  }

  const visibleEntries = entries.slice(0, limit)
  const hasBufferedVisibleEntries = entries.length > limit
  const lastVisibleBookmarkCursor =
    visibleEntries.length > 0
      ? toBookmarkCursor(visibleEntries[visibleEntries.length - 1].bookmark)
      : null
  let nextMaxBookmarkId: string | null = null

  if (
    hasBufferedVisibleEntries ||
    (visibleEntries.length === limit && !exhausted)
  ) {
    nextMaxBookmarkId = hasBufferedVisibleEntries
      ? lastVisibleBookmarkCursor
      : (lastScannedBookmarkCursor ?? lastVisibleBookmarkCursor)
  } else if (!exhausted) {
    nextMaxBookmarkId = lastScannedBookmarkCursor
  }

  return {
    statuses: visibleEntries.map((entry) => entry.status),
    nextMaxBookmarkId,
    prevMinBookmarkId:
      visibleEntries.length > 0
        ? toBookmarkCursor(visibleEntries[0].bookmark)
        : null
  }
}
