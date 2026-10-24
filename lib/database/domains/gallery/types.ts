// Parameter and result types of the gallery domain (gear and settings, the
// gallery media reads, the lookup cache, the album suggestions' item read and
// the albums), and its five Database interfaces. lib/database/types.ts
// composes them into `Database`.
import type { Media } from '@/lib/database/domains/media/types'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import type {
  GalleryDefault,
  GalleryGear,
  GalleryGearKind,
  GalleryHiddenLocation,
  GalleryMediaSort,
  GallerySettings,
  GalleryShow,
  IucnCategory,
  MediaLookupStatus,
  MediaPlaceNameSource,
  MediaPlacePrecision,
  MediaSubjectCategory,
  SubjectSuggestionMode
} from '@/lib/types/database/gallery'
import type {
  GalleryAlbum,
  GalleryAlbumSort,
  GalleryAlbumVisibility
} from '@/lib/types/database/galleryAlbums'
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
  // When the media was uploaded (`medias.createdAt`, epoch ms); set by the
  // gallery reads, absent on rows built by hand.
  uploadedAt?: number | null
  // When it sorts by date (`medias.sortAt`, epoch ms); set by getGalleryMedia.
  sortAt?: number | null
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

export type GalleryMediaCursor = GalleryAlbumCursor // { key: sortAt epoch ms, mediaId: number }

export interface GalleryMediaFilters {
  // A toSubjectKey key.
  subjectKey?: string
  category?: MediaSubjectCategory
  // toPlaceKey of the requested name; '' = no place. Owner only.
  placeKey?: string
  // YYYY-MM-DD inclusive. Owner only.
  takenFrom?: string
  // YYYY-MM-DD inclusive. Owner only.
  takenTo?: string
  // Fitness file id; null = not from an activity. Owner only.
  activityId?: string | null
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
  // Default 'uploaded'; a non-owner always gets 'uploaded'.
  sort?: GalleryMediaSort
  // Date sorts only.
  cursor?: GalleryMediaCursor
  filters?: GalleryMediaFilters
}

export interface CountGalleryMediaParams {
  actorId: string
  audience: GalleryAudience
  show?: GalleryShow
  gearId?: string
  filters?: GalleryMediaFilters
  albumId?: string
  // The list's sort: a date sort leaves out rows without a `sortAt`, so the
  // count must too.
  sort?: GalleryMediaSort
}

// `inAlbum` is null without `albumId`.
export interface GalleryMediaCount {
  total: number
  inAlbum: number | null
}

// Owner audience implied.
export interface GetGalleryMediaFacetRowsParams {
  actorId: string
  show?: GalleryShow
}

export interface GalleryMediaFacetRows {
  total: number
  places: Array<{ placeName: string | null; count: number }>
  months: Array<{ month: string; count: number }>
  subjects: Array<{
    subjectName: string | null
    subjectScientificName: string | null
    subjectCategory: MediaSubjectCategory | null
    count: number
  }>
  // Distinct media in scope attached to an activity's post, route map included.
  activityMediaCount: number
  activityPhotos: Array<{
    fitnessFileId: string
    activityType: string | null
    activityStartTime: number | null
    totalDistanceMeters: number | null
    mediaId: string
    placeName: string | null
  }>
}

export interface GetGalleryMediaByIdsParams {
  actorId: string
  audience: GalleryAudience
  mediaIds: string[]
  // Owner only (ignored for a viewer): the same `show` the ids were found with.
  show?: GalleryShow
  // `false` skips the gallery switch for every audience (the album reads:
  // a photo hidden from the gallery stays in its albums). Default true.
  requireInGallery?: boolean
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
  countGalleryMedia(params: CountGalleryMediaParams): Promise<GalleryMediaCount>
  getGalleryMediaFacetRows(
    params: GetGalleryMediaFacetRowsParams
  ): Promise<GalleryMediaFacetRows>
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

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export type GalleryAlbumPatch = {
  title?: string
  // `null` clears it.
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  // A media id of the album's own items; `null` clears the explicit cover.
  coverMediaId?: string | null
}

export interface CreateGalleryAlbumWithinLimitParams {
  actorId: string
  title: string
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  // The most albums the actor may hold; at or past it nothing is inserted.
  limit: number
  // The first photos, added in the same transaction as the album: either both
  // are written or neither is, so a failed add never leaves an empty album.
  mediaIds?: string[]
  // The most items an album may hold, for `mediaIds`.
  itemLimit?: number
}

export type CreateGalleryAlbumWithinLimitResult =
  | {
      status: 'created'
      album: GalleryAlbum
      // What became of `mediaIds`, as `addGalleryAlbumItems` reports it (all
      // empty without `mediaIds`).
      added: string[]
      existing: string[]
      skipped: string[]
    }
  | { status: 'limit-reached' }

export interface GetGalleryAlbumParams {
  id: string
  // The album's owner. An album of anyone else reads as missing.
  actorId: string
  audience: GalleryAudience
}

export interface GetGalleryAlbumSummariesParams {
  actorId: string
  audience: GalleryAudience
  // Only this album.
  albumId?: string
}

export interface UpdateGalleryAlbumParams extends GalleryAlbumPatch {
  id: string
  actorId: string
}

export type UpdateGalleryAlbumResult =
  | { status: 'updated'; album: GalleryAlbum }
  | { status: 'not-found' }
  // The cover is not one of the album's items.
  | { status: 'invalid-cover' }

export interface DeleteGalleryAlbumParams {
  id: string
  actorId: string
}

export interface AddGalleryAlbumItemsParams {
  albumId: string
  actorId: string
  mediaIds: string[]
  // The most items the album may hold; a request that would pass it adds
  // nothing at all.
  limit: number
}

export type AddGalleryAlbumItemsResult =
  | {
      status: 'added'
      // Newly added.
      added: string[]
      // Already in the album: left as they are.
      existing: string[]
      // Not the actor's own gallery media (foreign, missing, unposted or not in
      // the gallery): ignored.
      skipped: string[]
    }
  | { status: 'not-found' }
  | { status: 'limit-reached' }

export interface RemoveGalleryAlbumItemsParams {
  albumId: string
  actorId: string
  mediaIds: string[]
}

export type RemoveGalleryAlbumItemsResult =
  { status: 'removed'; removed: string[] } | { status: 'not-found' }

/** An album with what the audience can see of it. */
export interface GalleryAlbumSummary {
  album: GalleryAlbum
  // Visible items only.
  itemCount: number
  // The earliest and latest capture dates (upload date when there is none) of
  // the visible items, epoch milliseconds; null with no visible item.
  firstAt: number | null
  lastAt: number | null
  // The explicit cover when the audience can see it, else the newest visible
  // item; null with no visible item. Never a hidden item.
  coverMediaId: string | null
  // Up to three visible media ids for a card's collage, `coverMediaId` first.
  previewMediaIds: string[]
}

/** One visible item of an album, with what its facts and filters are read from. */
export interface GalleryAlbumIndexRow extends GalleryIndexRow {
  // Epoch milliseconds the media joined the album.
  addedAt: number
}

/** A position in an album's order: the sort key and the media id. */
export interface GalleryAlbumCursor {
  key: number
  mediaId: number
}

export interface GetGalleryAlbumMediaParams {
  albumId: string
  actorId: string
  audience: GalleryAudience
  sort: GalleryAlbumSort
  // Rows strictly after this position in `sort` order.
  after?: GalleryAlbumCursor
  // Callers ask for one more than a page to learn whether there is more.
  limit: number
  // A `toSubjectKey` key; only that species.
  subjectKey?: string
}

export interface GalleryAlbumMediaRow extends GalleryMediaRow {
  // The value the row was ordered by (see `GalleryAlbumSort`).
  sortKey: number
}

export interface GetGalleryAlbumIndexParams {
  albumId: string
  actorId: string
  audience: GalleryAudience
  // Read the audience's rows even when the audience may not open the album
  // itself (a private album read as the public). For the owner's own preview of
  // what a visitor would see, once the caller has checked ownership; the
  // photos are still scoped to the audience.
  ignoreAlbumVisibility?: boolean
}

export interface GetGalleryAlbumPlaceIndexesParams {
  actorId: string
  audience: GalleryAudience
  // Only this album.
  albumId?: string
}

export interface CountGalleryAlbumMediaParams {
  actorId: string
  audience: GalleryAudience
}

export interface HasVisibleGalleryAlbumsParams {
  actorId: string
  audience: GalleryAudience
}

export interface CountGalleryAlbumStoredItemsParams {
  albumId: string
  actorId: string
}

export interface GetAlbumsForMediaParams {
  mediaId: string
  actorId: string
  audience: GalleryAudience
}

export interface GalleryAlbumDatabase {
  // The album, the cap, the insert and the first photos are decided in one
  // transaction serialised on the actor row, so concurrent creates cannot
  // overshoot the cap and a failed add leaves no album behind.
  createGalleryAlbumWithinLimit(
    params: CreateGalleryAlbumWithinLimitParams
  ): Promise<CreateGalleryAlbumWithinLimitResult>
  // The owner sees any album of theirs. Anyone else sees only a `public` album
  // with at least one item visible to them; otherwise it reads as missing,
  // exactly like an id that does not exist.
  getGalleryAlbum(params: GetGalleryAlbumParams): Promise<GalleryAlbum | null>
  // The actor's albums, last updated first, with counts, dates, cover and
  // collage from visible items. Anyone but the owner gets only public albums
  // with something visible, and their `createdAt` and `updatedAt` (and so the
  // order) are computed from the visible items only: when the first and the
  // latest of them joined the album.
  getGalleryAlbumSummaries(
    params: GetGalleryAlbumSummariesParams
  ): Promise<GalleryAlbumSummary[]>
  updateGalleryAlbum(
    params: UpdateGalleryAlbumParams
  ): Promise<UpdateGalleryAlbumResult>
  // Removes the album and its items; the media stays. False for a missing or
  // foreign album.
  deleteGalleryAlbum(params: DeleteGalleryAlbumParams): Promise<boolean>
  // Atomic: all of it or nothing. Only the actor's own gallery media is added;
  // anything else is reported as skipped.
  addGalleryAlbumItems(
    params: AddGalleryAlbumItemsParams
  ): Promise<AddGalleryAlbumItemsResult>
  removeGalleryAlbumItems(
    params: RemoveGalleryAlbumItemsParams
  ): Promise<RemoveGalleryAlbumItemsResult>
  // A page of the album's visible media in `sort` order, each with the post it
  // is shown through. Empty for a missing album.
  getGalleryAlbumMedia(
    params: GetGalleryAlbumMediaParams
  ): Promise<GalleryAlbumMediaRow[]>
  // Every visible item of the album, unordered, for the facts line and the
  // species filter.
  getGalleryAlbumIndex(
    params: GetGalleryAlbumIndexParams
  ): Promise<GalleryAlbumIndexRow[]>
  // The visible items that carry a place, grouped by album, for the owner's
  // "places hidden" count on the album cards: one read for every album (or
  // just `albumId`), with only the subject and place columns. Albums the
  // audience may not open are left out; albums with nothing to report may be
  // too.
  getGalleryAlbumPlaceIndexes(
    params: GetGalleryAlbumPlaceIndexesParams
  ): Promise<{ albumId: string; rows: GalleryAlbumIndexRow[] }[]>
  // How many distinct media the audience can see across the actor's albums
  // (public albums only, for anyone but the owner). A photo in several albums
  // counts once.
  countGalleryAlbumMedia(params: CountGalleryAlbumMediaParams): Promise<number>
  // Whether the audience can open at least one of the actor's albums: for the
  // owner any album, for anyone else a public album with at least one visible
  // item. One `EXISTS`-shaped read, for the profile's Albums chip.
  getActorHasVisibleGalleryAlbums(
    params: HasVisibleGalleryAlbumsParams
  ): Promise<boolean>
  // How many items the album holds against its item cap: every stored row
  // whose media still exists, whether or not the owner can see it any more (a
  // deleted post's photo still counts). 0 for a missing or foreign album. Owner
  // data: callers must only send it to the owner.
  countGalleryAlbumStoredItems(
    params: CountGalleryAlbumStoredItemsParams
  ): Promise<number>
  // The albums the media is in. Owner only: any other audience gets none.
  getAlbumsForMedia(
    params: GetAlbumsForMediaParams
  ): Promise<{ id: string; title: string }[]>
}
