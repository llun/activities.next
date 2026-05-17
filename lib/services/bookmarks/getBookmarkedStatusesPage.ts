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
}

interface BookmarkedStatusesPage {
  bookmarks: Bookmark[]
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
  sinceId
}: GetBookmarkedStatusesPageParams): Promise<BookmarkedStatusesPage> => {
  const entries: Array<{ bookmark: Bookmark; status: Status }> = []
  let cursor = maxId ?? null
  let iterations = 0
  let lastScannedBookmarkId: string | null = null
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
      sinceId
    })
    if (bookmarks.length === 0) {
      exhausted = true
      break
    }

    const statuses = await database.getStatusesByIds({
      statusIds: bookmarks.map((bookmark) => bookmark.statusId),
      currentActorId: actorId,
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

    cursor = bookmarks[bookmarks.length - 1].id
    lastScannedBookmarkId = cursor

    if (bookmarks.length < limit) {
      exhausted = true
      break
    }
  }

  const visibleEntries = entries.slice(0, limit)
  const hasBufferedVisibleEntries = entries.length > limit
  const lastVisibleBookmarkId =
    visibleEntries.length > 0
      ? visibleEntries[visibleEntries.length - 1].bookmark.id
      : null
  let nextMaxBookmarkId: string | null = null

  if (
    hasBufferedVisibleEntries ||
    (visibleEntries.length === limit && !exhausted)
  ) {
    nextMaxBookmarkId = hasBufferedVisibleEntries
      ? lastVisibleBookmarkId
      : (lastScannedBookmarkId ?? lastVisibleBookmarkId)
  } else if (!exhausted) {
    nextMaxBookmarkId = lastScannedBookmarkId
  }

  return {
    bookmarks: visibleEntries.map((entry) => entry.bookmark),
    statuses: visibleEntries.map((entry) => entry.status),
    nextMaxBookmarkId,
    prevMinBookmarkId:
      visibleEntries.length > 0 ? visibleEntries[0].bookmark.id : null
  }
}
