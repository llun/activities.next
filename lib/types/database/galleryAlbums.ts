// Types for gallery albums: owner-curated groups of the owner's own gallery
// media. This module is deliberately free of server-only imports — the Albums
// pages and the client helpers import these types and constants too (see
// AGENTS.md → Server/Client Module Boundary).

// Who may open an album. Followers-only albums are not offered: a follower
// still sees their followers-only photos inside a public album, because every
// item is filtered per viewer at read time.
export const GALLERY_ALBUM_VISIBILITIES = ['public', 'private'] as const
export type GalleryAlbumVisibility = (typeof GALLERY_ALBUM_VISIBILITIES)[number]

// How an album's photos are ordered. `taken_*` sorts by the capture date (the
// upload date when there is none); `added_desc` by when the photo joined the
// album. Every mode breaks ties on the media id, so a page boundary is stable.
export const GALLERY_ALBUM_SORTS = [
  'taken_desc',
  'taken_asc',
  'added_desc'
] as const
export type GalleryAlbumSort = (typeof GALLERY_ALBUM_SORTS)[number]

export const DEFAULT_GALLERY_ALBUM_VISIBILITY: GalleryAlbumVisibility = 'public'
export const DEFAULT_GALLERY_ALBUM_SORT: GalleryAlbumSort = 'taken_desc'

// `title` is varchar(120); `description` is text, bounded here.
export const MAX_GALLERY_ALBUM_TITLE_LENGTH = 120
export const MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH = 1000
// Albums one actor may hold, photos one album may hold, and media ids one
// add or remove request may carry.
export const MAX_GALLERY_ALBUMS_PER_ACTOR = 200
export const MAX_GALLERY_ALBUM_ITEMS = 2000
export const MAX_GALLERY_ALBUM_REQUEST_IDS = 100
// What the add route answers (422) when the photos would take an album past
// its cap. The client matches it to tell "album is full" from other failures.
export const GALLERY_ALBUM_FULL_MESSAGE = 'Too many photos in this album'

export interface SQLGalleryAlbum {
  id: string
  actorId: string
  title: string
  description?: string | null
  coverMediaId?: number | string | null
  visibility: string
  sortOrder: string
  // Loose because the two backends hand timestamps back differently.
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

export interface GalleryAlbum {
  id: string
  actorId: string
  title: string
  description: string | null
  // The owner's explicit choice, whether or not the audience can see it. The
  // cover a viewer is shown is `GalleryAlbumSummary.coverMediaId`.
  coverMediaId: string | null
  visibility: GalleryAlbumVisibility
  sortOrder: GalleryAlbumSort
  // Epoch milliseconds. In a summary read for a visitor these are computed
  // from the photos that visitor can see (when the first and the latest of them
  // joined the album), never the stored times, which move with hidden photos.
  createdAt: number
  updatedAt: number
}
