// Types for the media gallery: the details a `medias` row carries beyond alt
// text, the camera/lens gear they reference, and the per-actor gallery
// settings. This module is deliberately free of server-only imports — the
// composer and the viewer import these types too (see AGENTS.md → Server/Client
// Module Boundary).
import type { FitnessPrivacyRadiusMeters } from '@/lib/services/fitness-files/privacy'

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

// What a subject or place lookup last came to. Null on a row means it was
// never attempted (or, for a subject, that the subject is not species-like).
export const MEDIA_LOOKUP_STATUSES = [
  'pending',
  'resolved',
  'no-match',
  'failed',
  'disabled'
] as const
export type MediaLookupStatus = (typeof MEDIA_LOOKUP_STATUSES)[number]

// IUCN Red List categories, as GBIF reports them. Only CR, EN and VU count as
// threatened (see `THREATENED_IUCN` in `lib/services/gallery/threatenedSpecies.ts`).
export const IUCN_CATEGORIES = [
  'CR',
  'EN',
  'VU',
  'NT',
  'LC',
  'DD',
  'NE',
  'EW',
  'EX'
] as const
export type IucnCategory = (typeof IUCN_CATEGORIES)[number]

// Who wrote `placeName`. A null source is a name from before lookups existed,
// and is treated as the owner's.
export const MEDIA_PLACE_NAME_SOURCES = ['owner', 'geocoder'] as const
export type MediaPlaceNameSource = (typeof MEDIA_PLACE_NAME_SOURCES)[number]

// How the composer suggests a subject. `classifier` is reserved for a species
// classifier an admin may configure later; the API rejects it for now.
export const SUBJECT_SUGGESTION_MODES = ['model', 'off', 'classifier'] as const
export type SubjectSuggestionMode = (typeof SUBJECT_SUGGESTION_MODES)[number]

// The species-name confidence floor, in percent: 50 to 95 in steps of 5.
export const MIN_SUBJECT_CONFIDENCE_THRESHOLD = 50
export const MAX_SUBJECT_CONFIDENCE_THRESHOLD = 95
export const SUBJECT_CONFIDENCE_THRESHOLD_STEP = 5

// The largest `subjectSuggestions` JSON the database accepts, in bytes.
export const MAX_SUBJECT_SUGGESTIONS_BYTES = 16 * 1024

/**
 * The vision model's subject candidates for one media, as stored in
 * `medias.subjectSuggestions`. Owner-only, and never applied to the `subject*`
 * columns by itself: only the owner's save does that.
 */
export interface MediaSubjectSuggestions {
  model: string
  // ISO 8601.
  generatedAt: string
  checkedAgainst: 'gbif' | null
  candidates: {
    name: string
    scientificName: string | null
    category: MediaSubjectCategory
    // 0..1.
    confidence: number
    taxonKey: string | null
    rank: string | null
    taxonPath: string[]
  }[]
  group: MediaSubjectCategory | null
}

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
  // GBIF usage key: set by the owner's picker or by the subject lookup.
  subjectTaxonKey: string | null
  // Below here, what the lookups resolve. None of it is client-writable: the
  // update path resets it when the subject or the coordinates change, and only
  // `setMediaSubjectLookup` / `setMediaPlaceLookup` /
  // `setMediaSubjectSuggestions` write it.
  //
  // Kingdom to family names, stored at resolve time so a public read never
  // triggers a lookup.
  subjectTaxonPath: string[] | null
  // Owner-only: never sent to anyone else. It only drives the place rule.
  subjectIucnCategory: IucnCategory | null
  subjectLookupStatus: MediaLookupStatus | null
  // Epoch milliseconds of the last attempt.
  subjectLookupAt: number | null
  // Owner-only.
  subjectSuggestions: MediaSubjectSuggestions | null
  // ISO 3166-1 alpha-2, upper case.
  placeCountryCode: string | null
  placeNameSource: MediaPlaceNameSource | null
  placeLookupStatus: MediaLookupStatus | null
  // Epoch milliseconds the place lookup became pending, or was last attempted.
  placeLookupAt: number | null
}

// The details only the lookups write (see `MediaDetailsRecord`).
export const MEDIA_LOOKUP_OWNED_DETAILS = [
  'subjectTaxonPath',
  'subjectIucnCategory',
  'subjectLookupStatus',
  'subjectLookupAt',
  'subjectSuggestions',
  'placeCountryCode',
  'placeNameSource',
  'placeLookupStatus',
  'placeLookupAt'
] as const satisfies readonly (keyof MediaDetailsRecord)[]
export type MediaLookupOwnedDetail = (typeof MEDIA_LOOKUP_OWNED_DETAILS)[number]

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
  inGallery: false,
  subjectTaxonKey: null,
  subjectTaxonPath: null,
  subjectIucnCategory: null,
  subjectLookupStatus: null,
  subjectLookupAt: null,
  subjectSuggestions: null,
  placeCountryCode: null,
  placeNameSource: null,
  placeLookupStatus: null,
  placeLookupAt: null
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

// A circle around a place the owner never wants a photo's location disclosed
// near. The same shape and radius options as Fitness privacy locations, so the
// two share an editor. Parsed through `parseGalleryHiddenLocations`
// (`lib/services/gallery/hiddenLocations.ts`) on every read and write.
export interface GalleryHiddenLocation {
  latitude: number
  longitude: number
  hideRadiusMeters: FitnessPrivacyRadiusMeters
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
  // For every viewer but the owner, a photo whose place falls inside one of
  // these has no place at all: not on the map, not on an item, not in the
  // details endpoint.
  hiddenLocations: GalleryHiddenLocation[]
  // For every viewer but the owner, a species-like subject's place is withheld
  // until a lookup confirms it is not IUCN CR, EN or VU. Fails closed: a
  // pending, failed or disabled lookup keeps the place hidden.
  hideThreatenedPlaces: boolean
  subjectSuggestionMode: SubjectSuggestionMode
  // Percent; below it the composer offers only the group ("Bird?").
  subjectConfidenceThreshold: number
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
  hiddenLocations: [],
  hideThreatenedPlaces: true,
  subjectSuggestionMode: 'model',
  subjectConfidenceThreshold: 70
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
  hideThreatenedPlaces?: boolean | number | null
  subjectSuggestionMode?: string | null
  subjectConfidenceThreshold?: number | string | null
  createdAt: number | Date
  updatedAt: number | Date
}
