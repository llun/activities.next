import type { Database } from '@/lib/database/types'
import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Bookmark } from '@/lib/types/domain/bookmark'
import type { Status } from '@/lib/types/domain/status'

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
  const bookmarks = await database.getBookmarks({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  })
  const statuses = await database.getStatusesByIds({
    statusIds: bookmarks.map((bookmark) => bookmark.statusId),
    currentActorId: actorId,
    withReplies: false
  })
  const statusMap = new Map<string, Status>(
    statuses.map((status) => [status.id, status])
  )
  const orderedStatuses = bookmarks
    .map((bookmark) => statusMap.get(bookmark.statusId))
    .filter((status): status is Status => Boolean(status))
  const readableStatuses = await filterReadableStatuses({
    database,
    statuses: orderedStatuses,
    currentActor
  })

  return {
    bookmarks,
    statuses: readableStatuses,
    nextMaxBookmarkId:
      bookmarks.length === limit ? bookmarks[bookmarks.length - 1].id : null,
    prevMinBookmarkId: bookmarks.length > 0 ? bookmarks[0].id : null
  }
}
