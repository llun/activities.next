import {
  GalleryGear,
  GalleryGearKind,
  GallerySettings,
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import type { Attachment } from '@/lib/types/domain/attachment'

// Entities the gallery routes send and `lib/client/gallery.ts` consumes. This
// module has no server-only imports: client components import these types.

/** A camera or lens as the web client consumes it. */
export interface GalleryGearEntity {
  id: string
  kind: GalleryGearKind
  name: string
  brand: string | null
  model: string | null
  productUrl: string | null
  retiredAt: number | null
  createdAt: number
}

export const toGalleryGearEntity = (gear: GalleryGear): GalleryGearEntity => ({
  id: gear.id,
  kind: gear.kind,
  name: gear.name,
  brand: gear.brand ?? null,
  model: gear.model ?? null,
  productUrl: gear.productUrl ?? null,
  retiredAt: gear.retiredAt ?? null,
  createdAt: gear.createdAt
})

/**
 * `GET/PUT /api/v1/gallery/settings`: the stored settings, flat, plus whether
 * the instance has alt text generation configured at all (which decides if the
 * auto-describe toggle and a Regenerate button can do anything).
 */
export type GallerySettingsEntity = GallerySettings & {
  altTextAvailable: boolean
}

/**
 * `GET /api/v1/gallery/media/:mediaId/details` — what anyone who may see the
 * post may learn about a photo. Never carries exact coordinates unless the
 * owner chose `exact` precision, and never carries gear unless the owner
 * shows it.
 */
export interface MediaPublicDetails {
  subject: {
    name: string | null
    scientificName: string | null
    category: MediaSubjectCategory | null
  } | null
  takenAt: string | null
  camera: { name: string } | null
  lens: { name: string } | null
  exposure: {
    focalLengthMm: number | null
    aperture: number | null
    exposureTime: string | null
    iso: number | null
  } | null
  place: {
    name: string | null
    precision: MediaPlacePrecision | null
    // Absent for `country`, `hidden` and a place with no precision; rounded to
    // a ~5 km grid for `area`; exact only for `exact`.
    latitude?: number
    longitude?: number
  } | null
}

// ---------------------------------------------------------------------------
// Gallery section entities. Everything below is what the account-scoped
// gallery routes send and what the owner pages hand to client views. They are
// built only by `galleryProjection.ts`, which decides what leaves the server.
// ---------------------------------------------------------------------------

/** One photo or video in a gallery grid. */
export interface GalleryItemEntity {
  mediaId: string
  // `getClientStatusId` of the status behind `attachment` — always a status
  // the requesting audience may read.
  statusId: string
  // The attachment row of that status (url, thumbnailUrl, width, height,
  // blurhash, name = alt text); feeds `Media` and `MediasModal`.
  attachment: Attachment
  subject: {
    name: string | null
    scientificName: string | null
    category: MediaSubjectCategory | null
  } | null
  // ISO 8601.
  takenAt: string | null
  // `id` is present only for the owner. Null for the public when the owner
  // does not show gear.
  camera: { id?: string; name: string } | null
  lens: { id?: string; name: string } | null
  exposure: MediaPublicDetails['exposure']
  // The owner gets the stored place with coordinates whatever the precision;
  // everyone else gets `getPublicPlace`.
  place:
    | MediaPublicDetails['place']
    | {
        name: string | null
        precision: MediaPlacePrecision | null
        latitude: number | null
        longitude: number | null
      }
    | null
}

export interface GalleryMediaPage {
  items: GalleryItemEntity[]
  // Pass back as `max_id` for the next page; null on the last page.
  nextMaxId: string | null
}

export interface GallerySubjectEntry {
  key: string
  name: string | null
  scientificName: string | null
  category: MediaSubjectCategory | null
  count: number
  // ISO 8601; the capture date, or the upload date when there is none.
  firstSeenAt: string | null
  lastSeenAt: string | null
  // The newest photo of the subject.
  cover: GalleryItemEntity
}

// A subject whose category is unknown is grouped under `unidentified`.
export type GallerySubjectGroupCategory = MediaSubjectCategory | 'unidentified'

export interface GallerySubjectsResponse {
  // In `MEDIA_SUBJECT_CATEGORIES` order, `unidentified` last; subjects in a
  // group newest first. Empty groups are left out.
  groups: {
    category: GallerySubjectGroupCategory
    subjects: GallerySubjectEntry[]
  }[]
  // Photos and videos with no subject name at all.
  unidentifiedCount: number
  // The index read stopped at `GALLERY_INDEX_CAP`; counts are a lower bound.
  truncated: boolean
}

export type GalleryLifeListEntry = Omit<GallerySubjectEntry, 'cover'> & {
  coverMediaId: string
}

export interface GalleryLifeListResponse {
  // Number of entries (species), not photos.
  total: number
  byCategory: Partial<Record<MediaSubjectCategory, number>>
  // Oldest first-seen first, so the row number reads as "the Nth species".
  // Landscapes and media with no subject name are not species and are left out.
  entries: GalleryLifeListEntry[]
  truncated: boolean
}

export type GalleryMapPrecision = MediaPlacePrecision | null

// `not-shown`: the precision never reaches the public map. `not-public-post`:
// every post using the photo is followers-only, direct or otherwise not public.
// `in-hidden-location`: inside one of the owner's hidden locations.
export type GalleryMapPublicState =
  | 'shown-exact'
  | 'shown-area'
  | 'not-shown'
  | 'not-public-post'
  | 'in-hidden-location'

export interface GalleryMapPoint {
  mediaId: string
  statusId: string
  latitude: number
  longitude: number
  // The public only ever gets `area` (snapped) and `exact`.
  precision: GalleryMapPrecision
  // Owner only: what the public map does with this point.
  publicState?: GalleryMapPublicState
  subjectName: string | null
  placeName: string | null
  thumbnailUrl: string | null
  takenAt: string | null
}

export interface GalleryMapResponse {
  // Newest media first; never ordered by coordinate.
  points: GalleryMapPoint[]
  truncated: boolean
}

export interface GalleryGearUsageEntity {
  // Gallery photos and videos taken with the gear.
  photoCount: number
  // Epoch milliseconds, over every posted photo with the gear.
  firstUsedAt: number | null
  lastUsedAt: number | null
}

export type GalleryGearWithUsageEntity = GalleryGearEntity &
  GalleryGearUsageEntity

/** The subviews the profile Gallery tab offers. */
export const GALLERY_SUBVIEWS = [
  'subjects',
  'recent',
  'map',
  'life-list'
] as const
export type GallerySubview = (typeof GALLERY_SUBVIEWS)[number]

const normalizeSubjectText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')

/**
 * The one identity of a subject, used to group, count and filter. A scientific
 * name wins (`sci:alcedo atthis`), so "Kingfisher" and "Common Kingfisher"
 * with the same binomial are one species; otherwise the common name
 * (`name:red fox`). Null when the media names no subject.
 *
 * Grouping happens in JS on purpose: SQLite's `lower()` folds ASCII only, so a
 * SQL GROUP BY would split "Ébène" from "ébène" on one backend and not the
 * other.
 */
export const toSubjectKey = (
  subject:
    | {
        name?: string | null
        scientificName?: string | null
      }
    | null
    | undefined
): string | null => {
  if (!subject) return null
  const scientificName = normalizeSubjectText(subject.scientificName)
  if (scientificName) return `sci:${scientificName}`
  const name = normalizeSubjectText(subject.name)
  if (name) return `name:${name}`
  return null
}
