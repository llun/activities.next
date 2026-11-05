import { z } from 'zod'

export const Bookmark = z.object({
  id: z.string(),
  actorId: z.string(),
  statusId: z.string(),
  // The boost URI the bookmark was created through, when it was not the status itself
  sourceStatusId: z.string().nullish(),
  // The owner's private folder the bookmark is filed in; null is unfiled
  folderId: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Bookmark = z.infer<typeof Bookmark>

// A private, owner-only folder of bookmarks. Never federated.
export const BookmarkFolder = z.object({
  id: z.string(),
  actorId: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type BookmarkFolder = z.infer<typeof BookmarkFolder>

export const MAX_BOOKMARK_FOLDERS_PER_ACTOR = 200
export const MAX_BOOKMARK_FOLDER_NAME_LENGTH = 120
