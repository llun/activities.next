import { z } from 'zod'

import type { BookmarkFolderWriteError } from '@/lib/database/domains/bookmark/types'
import {
  type BookmarkFolder,
  MAX_BOOKMARK_FOLDERS_PER_ACTOR,
  MAX_BOOKMARK_FOLDER_NAME_LENGTH
} from '@/lib/types/domain/bookmark'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// What the bookmark folder routes send: an Activities.next extension, owner
// only and never federated, so there are no counts (unreadable statuses would
// make them wrong) and no actor.
export interface BookmarkFolderEntity {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export const toBookmarkFolderEntity = (
  folder: BookmarkFolder
): BookmarkFolderEntity => ({
  id: folder.id,
  name: folder.name,
  created_at: getISOTimeUTC(folder.createdAt),
  updated_at: getISOTimeUTC(folder.updatedAt)
})

// POST and PATCH take the same body. The domain trims and checks the name
// again, and owns the case-insensitive duplicate and the cap.
export const BookmarkFolderRequest = z.object({
  name: z.string().trim().min(1).max(MAX_BOOKMARK_FOLDER_NAME_LENGTH)
})

export const BOOKMARK_FOLDER_WRITE_ERRORS: Record<
  Exclude<BookmarkFolderWriteError, 'not-found'>,
  string
> = {
  'invalid-name': `A folder name must be 1 to ${MAX_BOOKMARK_FOLDER_NAME_LENGTH} characters`,
  'duplicate-name': 'You already have a folder with that name',
  'limit-reached': `You can have up to ${MAX_BOOKMARK_FOLDERS_PER_ACTOR} bookmark folders`
}
