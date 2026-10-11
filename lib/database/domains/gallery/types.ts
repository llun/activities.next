// Parameter and result types of the gallery domain (gear and settings, the
// gallery media reads, the lookup cache and the album suggestions' item read),
// and its four Database interfaces. lib/database/types.ts composes them into
// `Database`.
import type { Media } from '@/lib/database/domains/media/types'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import type {
  GalleryDefault,
  GalleryGear,
  GalleryGearKind,
  GalleryHiddenLocation,
  GallerySettings,
  GalleryShow,
  IucnCategory,
  MediaLookupStatus,
  MediaPlaceNameSource,
  MediaPlacePrecision,
  MediaSubjectCategory,
  SubjectSuggestionMode
} from '@/lib/types/database/gallery'
import type { Attachment } from '@/lib/types/domain/attachment'

// ---------------------------------------------------------------------------
// Gear and settings
// ---------------------------------------------------------------------------

export interface CreateGalleryGearParams {
  actorId: string
  kind: GalleryGearKind
  name: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
  // Create-only: the identity every later upload resolves against.
  deviceKey?: string | null
}

export interface CreateGalleryGearWithinLimitParams extends CreateGalleryGearParams {
  // The most non-deleted gear rows the actor may hold; at or past it nothing
  // is inserted.
  limit: number
  // Hand back a non-deleted row of the same kind and normalised name instead
  // of adding a twin (the manual `POST /api/v1/gallery/gears` path, whose rows
  // carry no `deviceKey` to be unique on).
  dedupeByName?: boolean
}

export type CreateGalleryGearWithinLimitResult =
  | { status: 'created'; gear: GalleryGear }
  | { status: 'existing'; gear: GalleryGear }
  | { status: 'limit-reached' }

export interface GetGalleryGearParams {
  id: string
  actorId: string
}

export interface FindGalleryGearByDeviceKeyParams {
  actorId: string
  deviceKey: string
}

export interface GetGalleryGearNamesByIdsParams {
  ids: string[]
}

// Presence semantics: an omitted key is left alone; `null` clears the optional
// ones. `kind` and `deviceKey` are never editable.
export interface UpdateGalleryGearParams {
  id: string
  actorId: string
  name?: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
}

export interface SetGalleryGearRetiredParams {
  id: string
  actorId: string
  retired: boolean
}

export interface DeleteGalleryGearParams {
  id: string
  actorId: string
}

export interface GetGallerySettingsParams {
  actorId: string
}

// Presence semantics: an omitted key is left alone.
export interface UpdateGallerySettingsParams {
  actorId: string
  autoDescribe?: boolean
  allowEmptyDescription?: boolean
  subjectHashtags?: boolean
  galleryDefault?: GalleryDefault
  defaultPlacePrecision?: MediaPlacePrecision
  showGear?: boolean
  mapPublic?: boolean
  lifeListPublic?: boolean
  hiddenLocations?: GalleryHiddenLocation[]
  hideThreatenedPlaces?: boolean
  subjectSuggestionMode?: SubjectSuggestionMode
  // 50 to 95 in steps of 5; anything else is refused by the request schema
  // and read back as the default.
  subjectConfidenceThreshold?: number
  photoEnhance?: boolean
}

export interface GalleryDatabase {
  createGalleryGear(params: CreateGalleryGearParams): Promise<GalleryGear>
  // `createGalleryGear` behind the per-actor cap and an existing-row check,
  // decided and written in one transaction serialised on the actor row, so
  // concurrent creates can neither overshoot the cap nor insert twins.
  createGalleryGearWithinLimit(
    params: CreateGalleryGearWithinLimitParams
  ): Promise<CreateGalleryGearWithinLimitResult>
  // RULE FOR ANY FUTURE DELETE PATH: `gallery_gears` is soft-deleted but its
  // `(actorId, deviceKey)` unique index covers deleted rows, while
  // `findGalleryGearByDeviceKey` skips them. A delete must therefore set
  // `deviceKey = null` in the same update as `deletedAt` (mirroring
  // `deleteFitnessGear` in `lib/database/domains/fitnessGear/queries.ts`), or
  // the next upload from that camera can neither find nor re-create its gear.
  // Non-deleted gear of the actor, oldest first.
  getGalleryGearsByActor(params: { actorId: string }): Promise<GalleryGear[]>
  getGalleryGear(params: GetGalleryGearParams): Promise<GalleryGear | null>
  findGalleryGearByDeviceKey(
    params: FindGalleryGearByDeviceKeyParams
  ): Promise<GalleryGear | null>
  // `id -> name` for non-deleted gear, whoever owns it. Callers only pass ids
  // read off a media row, so there is nothing to scope by.
  getGalleryGearNamesByIds(
    params: GetGalleryGearNamesByIdsParams
  ): Promise<Record<string, string>>
  // The owner's own non-deleted gear only; null for a missing or foreign id.
  updateGalleryGear(
    params: UpdateGalleryGearParams
  ): Promise<GalleryGear | null>
  // Idempotent: a repeat does not move `retiredAt`. Null for a missing or
  // foreign id.
  setGalleryGearRetired(
    params: SetGalleryGearRetiredParams
  ): Promise<GalleryGear | null>
  // Soft-deletes, releases the `deviceKey` and detaches the actor's media from
  // the gear. False for a missing or foreign id.
  deleteGalleryGear(params: DeleteGalleryGearParams): Promise<boolean>
  // Always resolves: an actor with no row gets the defaults.
  getGallerySettings(params: GetGallerySettingsParams): Promise<GallerySettings>
  updateGallerySettings(
    params: UpdateGallerySettingsParams
  ): Promise<GallerySettings>
}

// ---------------------------------------------------------------------------
// Gallery media
// ---------------------------------------------------------------------------

/** A gallery photo or video together with the post it is shown through. */
export interface GalleryMediaRow {
  media: Media
  // The newest attachment of this media on a status the audience may read —
  // never one on a post the audience may not see. Null for the owner's media
  // that was added in Gallery and is not posted (then `statusId` is null too).
  attachment: Attachment | null
  statusId: string | null
  statusPublicId: string | null
}

/**
 * The lightweight per-media read the subject grouping works from. It carries
 * every field of `PublicPlaceInput` under the same names, so the country and
 * place stats can be computed from the PUBLIC projection of each row (a
 * withheld place adds no country) without a second read.
 */
export interface GalleryIndexRow {
  id: string
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: MediaSubjectCategory | null
  subjectTaxonKey: string | null
  subjectTaxonPath: string[] | null
  // Owner-only facts: they decide the place rule and never leave the server.
  subjectIucnCategory: IucnCategory | null
  subjectLookupStatus: MediaLookupStatus | null
  // The STORED place. Disclosing any of it is the projection's decision.
  placeName: string | null
  placePrecision: MediaPlacePrecision | null
  placeLatitude: number | null
  placeLongitude: number | null
  placeCountryCode: string | null
  // Who wrote the name: a geocoded name is never shown for `country`.
  placeNameSource: MediaPlaceNameSource | null
  // Epoch milliseconds.
  takenAt: number | null
  createdAt: number
}

/** A gallery media with stored coordinates, and the post it is shown through. */
export interface GalleryMapRow {
  id: string
  // The STORED point. Disclosing it is the projection's decision.
  latitude: number
  longitude: number
  placePrecision: MediaPlacePrecision | null
  placeName: string | null
  placeCountryCode: string | null
  placeNameSource: MediaPlaceNameSource | null
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: MediaSubjectCategory | null
  subjectTaxonKey: string | null
  // Owner-only facts: they decide the place rule and never leave the server.
  subjectIucnCategory: IucnCategory | null
  subjectLookupStatus: MediaLookupStatus | null
  takenAt: number | null
  // The chosen attachment's thumbnail, or its url when it is an image. Null
  // for an unposted media, which is addressed by `file` instead.
  thumbnailUrl: string | null
  // The stored files of the media itself: how an unposted media (no attachment
  // to take a url from) is shown.
  file: { path: string; thumbnailPath: string | null; mimeType: string }
  // Null for the owner's media that is added in Gallery but not posted.
  statusId: string | null
  statusPublicId: string | null
}

/** One (gear, media) pair; a media with both a camera and a lens gives two. */
export interface GalleryGearUsageRow {
  gearId: string
  mediaId: string
  inGallery: boolean
  originalMimeType: string
  // Owner-only rows, so the stored code (no projection).
  placeCountryCode: string | null
  takenAt: number | null
  createdAt: number
}

export interface GetActorHasGalleryMediaParams {
  actorId: string
  audience: GalleryAudience
}

export interface GetGalleryMediaParams {
  actorId: string
  audience: GalleryAudience
  // Exclusive upper bound on the media id. Not a row id → no rows.
  maxId?: string
  // Rows to return; callers ask for one more than a page to learn hasMore.
  limit: number
  // Camera or lens.
  gearId?: string
  // Owner only (ignored for a viewer): which media to list.
  show?: GalleryShow
}

export interface GetGalleryMediaByIdsParams {
  actorId: string
  audience: GalleryAudience
  mediaIds: string[]
  // Owner only (ignored for a viewer): the same `show` the ids were found with.
  show?: GalleryShow
}

export interface GetGalleryMediaIndexParams {
  actorId: string
  audience: GalleryAudience
  limit: number
  // Only media with an id below this one. An invalid id reads nothing.
  maxId?: string
  // Owner only (ignored for a viewer): which media to index.
  show?: GalleryShow
}

export interface GetGalleryMapRowsParams {
  actorId: string
  audience: GalleryAudience
  limit: number
}

export interface GetGalleryGearUsageRowsParams {
  actorId: string
  gearIds: string[]
}

export interface AddMediaToGalleryParams {
  actorId: string
  mediaIds: string[]
}

export interface GetUnattachedMediaParams {
  actorId: string
  mediaIds: string[]
}

export interface GalleryMediaDatabase {
  getActorHasGalleryMedia(
    params: GetActorHasGalleryMediaParams
  ): Promise<boolean>
  // Newest (highest id) first.
  getGalleryMedia(params: GetGalleryMediaParams): Promise<GalleryMediaRow[]>
  // Re-applies the whole scope: an id outside it is simply absent. Newest
  // first.
  getGalleryMediaByIds(
    params: GetGalleryMediaByIdsParams
  ): Promise<GalleryMediaRow[]>
  // Newest first.
  getGalleryMediaIndex(
    params: GetGalleryMediaIndexParams
  ): Promise<GalleryIndexRow[]>
  // Only media with both coordinates. For a viewer, only `area` and `exact`
  // precision rows are read at all. Newest first.
  getGalleryMapRows(params: GetGalleryMapRowsParams): Promise<GalleryMapRow[]>
  // Owner-only: every posted or Gallery-added media of the actor using one of
  // the gear ids, in the gallery or not (EXIF dates show real use either way).
  getGalleryGearUsageRows(
    params: GetGalleryGearUsageRowsParams
  ): Promise<GalleryGearUsageRow[]>
  // Keeps the actor's own media that no status uses in their gallery: stamps
  // `galleryAddedAt` and turns `inGallery` on, both only the first time, so
  // repeating the call changes nothing (a photo hidden since stays hidden).
  // Media of another actor, media a status already uses and ids that are not
  // media are skipped. Returns the ids that are now added.
  addMediaToGallery(params: AddMediaToGalleryParams): Promise<string[]>
  // The actor's own media among `mediaIds` that no status uses, whether or not
  // it was added in Gallery. Newest (highest id) first; any other id is simply
  // absent.
  getUnattachedMedia(params: GetUnattachedMediaParams): Promise<Media[]>
}

// ---------------------------------------------------------------------------
// Lookup cache
// ---------------------------------------------------------------------------

// `gallery_lookup_cache`: the read-through cache of GBIF and Nominatim answers
// the gallery lookups share, keyed by (`kind`, `key`). It is not linked to any
// actor, but geocode keys are ~5 km grid cells (`<lang>:<lat2>,<lng2>`), so the
// table is a coarse trace of where photos were taken: prune it, and never
// expose it.

export const GALLERY_LOOKUP_OUTCOMES = ['ok', 'miss', 'error'] as const
export type GalleryLookupOutcome = (typeof GALLERY_LOOKUP_OUTCOMES)[number]

// `kind` is varchar(32) and `key` varchar(255).
export const MAX_GALLERY_LOOKUP_KIND_LENGTH = 32
export const MAX_GALLERY_LOOKUP_KEY_LENGTH = 255

export interface GalleryLookupEntry {
  kind: string
  key: string
  outcome: GalleryLookupOutcome
  // The parsed JSON value; null for a miss or an error, or a corrupt blob.
  value: unknown
  // Epoch milliseconds.
  fetchedAt: number
  expiresAt: number
}

export interface GetGalleryLookupParams {
  kind: string
  key: string
  // Epoch milliseconds the expiry is judged against; defaults to now.
  now?: number
}

export interface PutGalleryLookupParams {
  kind: string
  key: string
  outcome: GalleryLookupOutcome
  // Stored as JSON. Ignored (stored as null) when undefined.
  value?: unknown
  // How long the entry stays fresh.
  ttlMs: number
  // Epoch milliseconds; defaults to now.
  now?: number
}

export interface PruneGalleryLookupsParams {
  // Entries that expired before this epoch-milliseconds time are deleted.
  before: number
  // The most rows one call deletes.
  limit: number
}

export interface GalleryLookupCacheDatabase {
  // The entry, or null when there is none or it has expired.
  getGalleryLookup(
    params: GetGalleryLookupParams
  ): Promise<GalleryLookupEntry | null>
  // Inserts or replaces the entry. A kind or key over its column length is
  // refused (nothing is written) rather than truncated into another key.
  putGalleryLookup(params: PutGalleryLookupParams): Promise<void>
  // Returns the number of rows deleted.
  pruneGalleryLookups(params: PruneGalleryLookupsParams): Promise<number>
}

// ---------------------------------------------------------------------------
// Album suggestions
// ---------------------------------------------------------------------------

// The one read the album suggestions need from the album tables: which of some
// media each of the owner's albums already holds, so a suggestion an album
// already covers is not offered again.

export interface GetGalleryAlbumItemSetsParams {
  actorId: string
  // The candidate media ids (the decimal `medias.id`). Only items among them are
  // read, in batches: a suggestion is covered when one album holds ALL its
  // photos, so an album's other items never matter.
  mediaIds: string[]
}

export interface GalleryAlbumItemSet {
  albumId: string
  // Media ids (the decimal `medias.id`), only those asked about.
  mediaIds: string[]
}

export interface GalleryAlbumSuggestionDatabase {
  // Owner data. Of the asked media ids, the ones each of the actor's albums
  // holds, whether or not the photo is still visible: an album that holds a
  // photo covers it. Albums holding none of them are left out.
  getGalleryAlbumItemSets(
    params: GetGalleryAlbumItemSetsParams
  ): Promise<GalleryAlbumItemSet[]>
}
