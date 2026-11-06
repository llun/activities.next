import { throwApiError } from '@/lib/client/http'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import { toIdPathSegment } from '@/lib/utils/urlToId'

// Private bookmark folders (an Activities.next extension, owner only). Folder
// ids are opaque UUIDs, so they go into paths with encodeURIComponent only.

export const getBookmarkFolders = async (): Promise<BookmarkFolderEntity[]> => {
  const response = await fetch('/api/v1/bookmark_folders', {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    await throwApiError(response, "Couldn't load your bookmark folders.")
  }
  return (await response.json()) as BookmarkFolderEntity[]
}

/** Throws an `ApiRequestError` carrying the server's message (a duplicate name, the cap). */
export const createBookmarkFolder = async (
  name: string
): Promise<BookmarkFolderEntity> => {
  const response = await fetch('/api/v1/bookmark_folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
  if (!response.ok) {
    await throwApiError(response, "Couldn't create the folder.")
  }
  return (await response.json()) as BookmarkFolderEntity
}

export const renameBookmarkFolder = async (
  id: string,
  name: string
): Promise<BookmarkFolderEntity> => {
  const response = await fetch(
    `/api/v1/bookmark_folders/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }
  )
  if (!response.ok) {
    await throwApiError(response, "Couldn't rename the folder.")
  }
  return (await response.json()) as BookmarkFolderEntity
}

export const deleteBookmarkFolder = async (id: string): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/bookmark_folders/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

/** Bookmarks the status if needed and files it; `null` unfiles it. */
export const setStatusBookmarkFolder = async ({
  statusId,
  folderId
}: {
  statusId: string
  folderId: string | null
}): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/bookmark_folder`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId })
    }
  )
  return response.ok
}
