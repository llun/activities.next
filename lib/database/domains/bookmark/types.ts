// Parameter and result types of the bookmark domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Bookmark, BookmarkFolder } from '@/lib/types/domain/bookmark'
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
/** Bookmarks the status if it is not bookmarked yet, then files it; null unfiles. */
export type FileBookmarkParams = BaseBookmarkParams & {
  folderId: string | null
}
export type FileBookmarkResult =
  'filed' | 'folder-not-found' | 'status-not-found'
export type GetBookmarksParams = {
  actorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
  /** Only one folder's bookmarks; null is the unfiled ones, undefined all. */
  folderId?: string | null
}

export type GetBookmarkFoldersParams = { actorId: string }
export type GetBookmarkFolderParams = { id: string; actorId: string }
export type CreateBookmarkFolderParams = { actorId: string; name: string }
export type UpdateBookmarkFolderParams = {
  id: string
  actorId: string
  name: string
}
export type DeleteBookmarkFolderParams = { id: string; actorId: string }

/** Why a folder name was refused: blank or too long, already used, or over the cap. */
export type BookmarkFolderWriteError =
  'invalid-name' | 'duplicate-name' | 'limit-reached' | 'not-found'
export type BookmarkFolderWriteResult =
  | { status: 'ok'; folder: BookmarkFolder }
  | { status: BookmarkFolderWriteError }

export interface BookmarkDatabase {
  createBookmark(params: CreateBookmarkParams): Promise<void>
  deleteBookmark(params: DeleteBookmarkParams): Promise<void>
  isActorBookmarkedStatus(
    params: IsActorBookmarkedStatusParams
  ): Promise<boolean>
  getBookmarks(params: GetBookmarksParams): Promise<Bookmark[]>
  fileBookmark(params: FileBookmarkParams): Promise<FileBookmarkResult>

  getBookmarkFolders(
    params: GetBookmarkFoldersParams
  ): Promise<BookmarkFolder[]>
  getBookmarkFolder(
    params: GetBookmarkFolderParams
  ): Promise<BookmarkFolder | null>
  createBookmarkFolder(
    params: CreateBookmarkFolderParams
  ): Promise<BookmarkFolderWriteResult>
  updateBookmarkFolder(
    params: UpdateBookmarkFolderParams
  ): Promise<BookmarkFolderWriteResult>
  deleteBookmarkFolder(params: DeleteBookmarkFolderParams): Promise<boolean>
}
