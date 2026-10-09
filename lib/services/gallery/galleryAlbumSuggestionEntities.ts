import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'

// Entities and limits of the album suggestions. This module has no server-only
// imports: the Albums pages and `lib/client/galleryAlbumSuggestions.ts` import
// it too. Built only by `galleryAlbumSuggestions.ts`.

export const GALLERY_ALBUM_SUGGESTION_KINDS = [
  'trip',
  'species',
  'activity_day'
] as const
export type GalleryAlbumSuggestionKind =
  (typeof GALLERY_ALBUM_SUGGESTION_KINDS)[number]

// A trip is a run of photos with no gap of more than this many days between
// two taken dates, and needs at least this many photos.
export const TRIP_MAX_GAP_DAYS = 3
export const TRIP_MIN_PHOTOS = 8
// A species needs at least this many photos to be a series.
export const SPECIES_MIN_PHOTOS = 5
// A day with a recorded activity needs at least this many photos taken that
// day: one or two snapshots are not an album.
export const ACTIVITY_DAY_MIN_PHOTOS = 5
// The media ids one suggestion carries: what an album can hold. A larger
// cluster says `truncated` and keeps its newest photos.
export const MAX_SUGGESTION_MEDIA_IDS = MAX_GALLERY_ALBUM_ITEMS
// At most this many suggestions of each kind, so one kind (every species with
// five photos) cannot crowd the others out.
export const MAX_SUGGESTIONS_PER_KIND = 6

export interface GalleryAlbumSuggestionEntity {
  // Stable for the same photos (`trip:2026-09-12`, `species:sci:alcedo atthis`,
  // `activity_day:2026-09-27`), so a client can tell it is the same suggestion.
  id: string
  kind: GalleryAlbumSuggestionKind
  // The album title to pre-fill. Public text once the album is public, so it
  // speaks only for the photos a visitor can see, names a place only when
  // `getPublicPlace` shows that one place for every one of them, and is
  // otherwise made of dates.
  title: string
  // All the photos of the cluster, also when `mediaIds` is cut short.
  photoCount: number
  // ISO 8601: the earliest and latest capture dates of the photos.
  firstAt: string | null
  lastAt: string | null
  // The photo of `mediaIds[0]`, which becomes the album's cover; null when it
  // could not be read.
  preview: GalleryItemEntity | null
  // The owner's own media ids, newest first, at most
  // `MAX_SUGGESTION_MEDIA_IDS`.
  mediaIds: string[]
  // True when the cluster has more photos than `mediaIds` holds.
  truncated: boolean
  // Computed from what a visitor would be shown (`getPublicPlace`), so a place
  // the public view withholds adds nothing.
  placeCount: number
  speciesCount: number
  // Recorded activities on the day; 0 for the other kinds.
  activityCount: number
}

export interface GalleryAlbumSuggestionsResponse {
  // Most recent first.
  suggestions: GalleryAlbumSuggestionEntity[]
}

/** `GET /api/v1/gallery/albums/suggestions/media`: the photos behind some ids. */
export interface GalleryAlbumSuggestionMediaResponse {
  // In the order asked; an id that is no longer the owner's gallery media is
  // left out.
  items: GalleryItemEntity[]
}
