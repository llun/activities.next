import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryAlbumSort,
  GalleryAlbumVisibility
} from '@/lib/types/database/galleryAlbums'

// Entities the album routes send and `lib/client/galleryAlbums.ts` consumes.
// This module has no server-only imports: client components import these
// types. Built only by `galleryAlbumQueries.ts`.

/** An album as the owner's pages and routes see it. */
export interface GalleryAlbumEntity {
  id: string
  title: string
  description: string | null
  visibility: GalleryAlbumVisibility
  sortOrder: GalleryAlbumSort
  // Epoch milliseconds.
  createdAt: number
  updatedAt: number
}

/** An album with what the requesting audience can see of it. */
export interface GalleryAlbumCardEntity extends GalleryAlbumEntity {
  // Visible items only.
  itemCount: number
  // ISO 8601: the earliest and latest capture dates (upload dates when there
  // is none) of the visible items.
  firstAt: string | null
  lastAt: string | null
  // The explicit cover when the audience can see it, else the newest visible
  // item; null when nothing is visible.
  cover: GalleryItemEntity | null
  // The collage: up to three visible items, the cover first.
  previews: GalleryItemEntity[]
  // The owner's explicit cover choice, owner only; null for anyone else and
  // when none was chosen. It can name an item the audience cannot see, so it
  // never goes to a visitor.
  coverMediaId: string | null
}

export interface GalleryAlbumListResponse {
  albums: GalleryAlbumCardEntity[]
  // Distinct visible photos across the albums: one in several albums counts
  // once.
  photoCount: number
}

export interface GalleryAlbumFacts {
  photoCount: number
  speciesCount: number
  placeCount: number
  countryCount: number
  dayCount: number
  // Distinct ISO 3166-1 alpha-2 codes of the places shown.
  countryCodes: string[]
  // The English name of the country when there is exactly one.
  countryName: string | null
  firstAt: string | null
  lastAt: string | null
}

export interface GalleryAlbumSpeciesChip {
  // A `toSubjectKey` key, sent back verbatim as the `subject` filter.
  key: string
  name: string
  count: number
}

export interface GalleryAlbumMediaPage {
  items: GalleryItemEntity[]
  // Pass back as `max_id` for the next page; null on the last page.
  nextMaxId: string | null
}

/** `GET /api/v1/gallery/albums/:id`: the owner's album page, first page included. */
export interface GalleryAlbumDetailResponse {
  album: GalleryAlbumCardEntity
  // Computed from what a visitor would be shown (the logged-out audience), so
  // the owner previews the real public numbers.
  facts: GalleryAlbumFacts
  // Owner only: how many distinct places the facts leave out because their
  // photo is of a threatened species (or its check has not finished).
  hiddenPlaceCount: number
  // The owner's own view of the species in the album, most photos first.
  species: GalleryAlbumSpeciesChip[]
  page: GalleryAlbumMediaPage
}

export interface GalleryAlbumItemsResult {
  added: string[]
  existing: string[]
  skipped: string[]
  album: GalleryAlbumCardEntity
}
