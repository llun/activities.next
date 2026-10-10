// Parameter and result types of the bookmark domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Bookmark } from '@/lib/types/domain/bookmark'
import type { StatusType } from '@/lib/types/domain/status'

interface BaseBookmarkParams {
  actorId: string
  statusId: string
}
export type CreateBookmarkParams = BaseBookmarkParams
export type DeleteBookmarkParams = BaseBookmarkParams
export type IsActorBookmarkedStatusParams = BaseBookmarkParams & {
  // Allows callers that already loaded the status to skip an extra lookup for non-Announce rows.
  statusType?: StatusType
}
export type GetBookmarksParams = {
  actorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface BookmarkDatabase {
  createBookmark(params: CreateBookmarkParams): Promise<void>
  deleteBookmark(params: DeleteBookmarkParams): Promise<void>
  isActorBookmarkedStatus(
    params: IsActorBookmarkedStatusParams
  ): Promise<boolean>
  getBookmarks(params: GetBookmarksParams): Promise<Bookmark[]>
}
