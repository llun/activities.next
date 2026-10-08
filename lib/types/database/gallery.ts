// Types for the media gallery: the details a `medias` row carries beyond alt
// text, the camera/lens gear they reference, and the per-actor gallery
// settings. This module is deliberately free of server-only imports — the
// composer and the viewer import these types too (see AGENTS.md → Server/Client
// Module Boundary).

export const MEDIA_SUBJECT_CATEGORIES = [
  'bird',
  'mammal',
  'reptile',
  'amphibian',
  'fish',
  'insect',
  'plant',
  'fungus',
  'landscape',
  'other'
] as const
export type MediaSubjectCategory = (typeof MEDIA_SUBJECT_CATEGORIES)[number]

// How much of a photo's location other people may learn. `exact` is the only
// precision that discloses the stored coordinates as they are.
export const MEDIA_PLACE_PRECISIONS = [
  'hidden',
  'country',
  'area',
  'exact'
] as const
export type MediaPlacePrecision = (typeof MEDIA_PLACE_PRECISIONS)[number]

// Whether a new upload lands in the owner's gallery: `always` and `never` are
// unconditional, `subject` waits until a subject is set on the media.
export const GALLERY_DEFAULTS = ['subject', 'always', 'never'] as const
export type GalleryDefault = (typeof GALLERY_DEFAULTS)[number]

export const GALLERY_GEAR_KINDS = ['camera', 'lens'] as const
export type GalleryGearKind = (typeof GALLERY_GEAR_KINDS)[number]

export interface MediaExposure {
  focalLengthMm?: number
  aperture?: number
  // Rendered as the photographer reads it: "1/2000", "0.5", "30".
  exposureTime?: string
  iso?: number
}

// The stored details of one `medias` row, as the database layer hands them out.
// Gear is referenced by id; names are resolved by the services that build an
// API entity.
export interface MediaDetailsRecord {
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: MediaSubjectCategory | null
  // Epoch milliseconds of EXIF `DateTimeOriginal`.
  takenAt: number | null
  cameraGearId: string | null
  lensGearId: string | null
  exposure: MediaExposure | null
  placeName: string | null
  placeLatitude: number | null
  placeLongitude: number | null
  placePrecision: MediaPlacePrecision | null
  inGallery: boolean
}

export const EMPTY_MEDIA_DETAILS: MediaDetailsRecord = {
  subjectName: null,
  subjectScientificName: null,
  subjectCategory: null,
  takenAt: null,
  cameraGearId: null,
  lensGearId: null,
  exposure: null,
  placeName: null,
  placeLatitude: null,
  placeLongitude: null,
  placePrecision: null,
  inGallery: false
}

// SQL row type for `gallery_gears`. Timestamps are loose because the two
// backends hand them back differently (see SQLFitnessGear).
export interface SQLGalleryGear {
  id: string
  actorId: string
  kind: GalleryGearKind
  name: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
  // The immutable identity an upload's EXIF resolves against, unique per actor:
  // `camera:<make>|<model>` or `lens:<lensModel>`, normalized.
  deviceKey?: string | null
  retiredAt?: number | Date | string | null

  createdAt: number | Date
  updatedAt: number | Date
  deletedAt?: number | Date | string | null
}

export interface GalleryGear {
  id: string
  actorId: string
  kind: GalleryGearKind
  name: string
  brand?: string
  model?: string
  productUrl?: string
  deviceKey?: string
  retiredAt?: number

  createdAt: number
  updatedAt: number
  deletedAt?: number
}

// One row per actor in `gallery_settings`; an actor without a row has every
// default below.
export interface GallerySettings {
  autoDescribe: boolean
  allowEmptyDescription: boolean
  subjectHashtags: boolean
  galleryDefault: GalleryDefault
  defaultPlacePrecision: MediaPlacePrecision
  showGear: boolean
  mapPublic: boolean
  lifeListPublic: boolean
  // JSON array, read by the gallery map in a later change.
  hiddenLocations: unknown[]
}

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  autoDescribe: true,
  allowEmptyDescription: true,
  subjectHashtags: true,
  galleryDefault: 'subject',
  defaultPlacePrecision: 'hidden',
  showGear: true,
  mapPublic: true,
  lifeListPublic: false,
  hiddenLocations: []
}

export interface SQLGallerySettings {
  actorId: string
  autoDescribe: boolean | number
  allowEmptyDescription: boolean | number
  subjectHashtags: boolean | number
  galleryDefault: string
  defaultPlacePrecision: string
  showGear: boolean | number
  mapPublic: boolean | number
  lifeListPublic: boolean | number
  hiddenLocations: string
  createdAt: number | Date
  updatedAt: number | Date
}
