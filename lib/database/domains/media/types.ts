// Parameter and result types of the media domain, and its MediaDatabase
// interface. lib/types/database/operations.ts re-exports them, so existing
// imports keep working.
import type {
  IucnCategory,
  MediaDetailsRecord,
  MediaLookupOwnedDetail,
  MediaLookupStatus,
  MediaSubjectCategory,
  MediaSubjectSuggestions
} from '@/lib/types/database/gallery'
import type { Attachment } from '@/lib/types/domain/attachment'

interface MetaData {
  width: number
  height: number
  upload?: {
    state: 'pending' | 'verified'
    checksumSha1?: string
    checksumSha1Base64?: string
    contentType?: string
    size?: number
    verifiedAt?: number
    // The key the client's presigned PUT targeted, recorded when the stripped
    // copy is swapped in. The presigned URL outlives the swap, so a re-PUT can
    // recreate an object here; media deletion removes this key too.
    clientPath?: string
  }
}

interface BaseMedia {
  actorId: string
  original: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
    fileName?: string
  }
  thumbnail?: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
  }
  description?: string
  // Focal point for cropping previews, each axis in [-1.0, 1.0]. Mastodon's
  // MediaAttachment `meta.focus`.
  focus?: { x: number; y: number }
  blurhash?: string | null
  // Subject, EXIF-derived and owner-edited details (see MediaDetailsRecord).
  // Omitted fields take the column default. The lookup-owned details are not
  // writable here (see UpdateMediaDetailsParams).
  details?: UpdateMediaDetailsParams
}

// A processed thumbnail ready to persist on an existing media row. Mirrors the
// shape `createMedia` already accepts for `thumbnail`.
export type MediaThumbnailInput = {
  path: string
  bytes: number
  mimeType: string
  metaData: { width: number; height: number }
}

export interface Media extends Omit<BaseMedia, 'details'> {
  id: string
  // Always present on a row read from the database; may be absent on a Media
  // built by hand (tests, in-memory fixtures).
  details?: MediaDetailsRecord
  // The photo edit state: `version` moves on every save and revert, and
  // `editedAt` (epoch milliseconds) is null while the photo is unedited.
  // Present on a row read through MEDIA_COLUMNS.
  edit?: { version: number; editedAt: number | null }
}

export interface MediaWithStatus extends Media {
  statusId?: string
}

export interface PaginatedMediaWithStatus {
  items: MediaWithStatus[]
  total: number
}

export type CreateMediaParams = BaseMedia

export type CreateAttachmentParams = {
  actorId: string
  statusId: string
  mediaType: string
  url: string
  width?: number
  height?: number
  name?: string
  mediaId?: string
  createdAt?: number
  blurhash?: string | null
  focus?: { x: number; y: number } | null
  thumbnailUrl?: string | null
  playbackType?: 'gifv' | 'video' | 'unknown' | null
}
export type UpdateAttachmentPlaybackParams = {
  id: string
  // The status the attachment belongs to. An attachment id alone is not enough:
  // remote attachment ids can be attacker-chosen strings, so the update is
  // scoped to the status being enriched and can never reach another one's row.
  statusId: string
  playbackType: 'gifv' | 'video' | 'unknown'
  thumbnailUrl?: string | null
  onlyIfUnset?: boolean
}
export type GetAttachmentsParams = {
  statusId: string
}
export type ReplaceRemoteAttachmentsForStatusParams = {
  statusId: string
  // The rows the note now carries, created in place of the old ones.
  attachments: CreateAttachmentParams[]
}
export type AttachmentWithMedia = Attachment & {
  mediaId?: string | null
}
export type GetAttachmentsWithMediaParams = {
  statusId: string
}
export type GetAttachmentsForActorParams = {
  actorId: string
  limit?: number
  maxCreatedAt?: number
  // Visibility of the STATUS each attachment hangs off, with the same meaning
  // and the same "all absent means no filter" default as GetActorStatusesParams
  // above — an attachment is exactly as readable as the post carrying it, so a
  // gallery must be scoped the same way its timeline is. Resolve these with
  // `resolveActorStatusesAudience` rather than spelling them out.
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
}
export type GetMediasForAccountParams = {
  accountId: string
  limit?: number
  page?: number
  maxCreatedAt?: number
}
export type GetStorageUsageForAccountParams = {
  accountId: string
}
export type DeleteMediaParams = {
  mediaId: string
}
export type DeleteMediaForAccountParams = {
  mediaId: string
  accountId: string
}
// Mirrors Mastodon's destroy semantics: `not-found` (missing or owned by another
// account) → 404, `in-use` (still attached to a posted status) → 422, `deleted`
// → 200. On `deleted`, `files` carries the storage paths captured inside the
// delete transaction so the caller can remove them without a separate (racy)
// prefetch.
export type DeleteMediaForAccountResult =
  | { status: 'deleted'; files: string[] }
  | { status: 'not-found' }
  | { status: 'in-use' }
// `deleteMediaWithFiles`: `files` carries the storage paths captured inside
// the delete's transaction (the live file, its thumbnail and every photo edit
// file), for the caller to delete after the commit.
export type DeleteMediaWithFilesResult =
  { status: 'deleted'; files: string[] } | { status: 'not-found' }
export type DeleteAttachmentsByIdsParams = {
  attachmentIds: string[]
}
export type GetMediaByIdParams = {
  mediaId: string
  accountId: string
}
export type GetMediaByIdsForAccountParams = {
  mediaIds: string[]
  accountId: string
}
export type UpdateMediaParams = {
  mediaId: string
  accountId: string
  // Narrows the owner check from the account to one of its actors. Set by
  // actor-scoped callers (a status edit's media_attributes), whose OAuth token
  // is bound to a single actor.
  actorId?: string
  description?: string | null
  focus?: { x: number; y: number }
  blurhash?: string | null
  thumbnail?: MediaThumbnailInput
  // Presence semantics, like the fields above: an omitted key is left alone and
  // an explicit null clears the column. `details` is narrowed to what an update
  // may write — `inGallery` is a boolean, never null.
  details?: UpdateMediaDetailsParams
}
// The lookup-owned details (`MEDIA_LOOKUP_OWNED_DETAILS`) are not writable
// here: the update resets them itself when the subject or the coordinates
// change, and only the lookup methods below set them.
export type UpdateMediaDetailsParams = Partial<
  Omit<MediaDetailsRecord, 'inGallery' | MediaLookupOwnedDetail>
> & { inGallery?: boolean }
export type UpdateMediaResult = {
  media: Media
  // Path of the thumbnail this update replaced, captured inside the update
  // transaction so the caller can delete it race-free. null when no existing
  // thumbnail was replaced.
  replacedThumbnailPath: string | null
}
export type MarkMediaUploadVerifiedParams = {
  mediaId: string
  accountId: string
  verifiedAt: number
  // The dimensions probed from the uploaded bytes, replacing the ones the
  // client declared when it asked for the presigned URL.
  dimensions?: { width: number; height: number }
  // The size of the original after completion rewrote it (metadata stripped),
  // replacing the declared size. The account's media usage counter moves by the
  // difference.
  originalBytes?: number
  // The key the rewritten original was stored under. Completion writes the
  // stripped copy to a NEW key and swaps it in here, so the client's upload is
  // never overwritten while the row is still pending.
  originalPath?: string
  // The client's presign key being replaced by `originalPath`; persisted in
  // `upload.clientPath` so deletion can remove a re-PUT at that key.
  clientPath?: string
  // The details built from the client's bytes before they were stripped (EXIF
  // date, gear, place, the gallery default). Written in the same conditional
  // pending → verified update as `originalPath`, so they commit with the swap
  // or not at all: once the client's object is deleted they cannot be
  // rebuilt. Same presence semantics as `UpdateMediaParams.details`.
  details?: UpdateMediaDetailsParams
}
// `transitioned` is true only for the one call whose conditional
// pending → verified update changed the row; a concurrent or repeated
// completion gets the already-verified media back with `transitioned: false`
// and must not apply its own side effects (the usage counter moves only on the
// transition).
export type MarkMediaUploadVerifiedResult = {
  media: Media
  transitioned: boolean
}

export type GetMediaWithAttachedStatusIdsParams = {
  mediaId: string
}
// A media row together with the statuses it is attached to, for the public
// details endpoint — which has no account to scope by and therefore must be
// paired with a status visibility check.
export type MediaWithAttachedStatusIds = {
  media: Media
  statusIds: string[]
  galleryAddedAt: number | null
}

// Compare-and-set writes of a lookup's result. `expect` holds the values the
// lookup read; the write lands only if the row still has them (null compares
// as IS NULL), so an owner edit made while the lookup ran wins. Both return
// whether the row was written.
export type SetMediaSubjectLookupParams = {
  mediaId: string
  expect: {
    subjectName: string | null
    subjectScientificName: string | null
    subjectTaxonKey: string | null
    // Optional: compared only when given.
    subjectCategory?: MediaSubjectCategory | null
  }
  patch: {
    subjectLookupStatus: MediaLookupStatus | null
    // Omitted keys are left alone. A resolved taxon must carry a category
    // (`NE` when GBIF has no assessment): `resolved` with none keeps the place
    // withheld.
    subjectIucnCategory?: IucnCategory | null
    subjectTaxonKey?: string | null
    subjectTaxonPath?: string[] | null
    // Epoch milliseconds; defaults to now.
    subjectLookupAt?: number
  }
}
export type SetMediaPlaceLookupParams = {
  mediaId: string
  expect: {
    placeLatitude: number | null
    placeLongitude: number | null
  }
  patch: {
    placeLookupStatus: MediaLookupStatus | null
    // Epoch milliseconds; defaults to now.
    placeLookupAt?: number
    // Omitted keys are left alone.
    placeCountryCode?: string | null
    // Written (with `placeNameSource = 'geocoder'`) only when the stored name
    // is null or was itself the geocoder's; an owner's name is never replaced.
    placeName?: string | null
  }
}
// Owner-only subject suggestions; null clears them. A blob over
// `MAX_SUBJECT_SUGGESTIONS_BYTES` is refused (returns false).
export type SetMediaSubjectSuggestionsParams = {
  mediaId: string
  suggestions: MediaSubjectSuggestions | null
}

export interface MediaDatabase {
  setMediaSubjectLookup(params: SetMediaSubjectLookupParams): Promise<boolean>
  setMediaPlaceLookup(params: SetMediaPlaceLookupParams): Promise<boolean>
  setMediaSubjectSuggestions(
    params: SetMediaSubjectSuggestionsParams
  ): Promise<boolean>
  createMedia(params: CreateMediaParams): Promise<Media | null>
  getMediaWithAttachedStatusIds(
    params: GetMediaWithAttachedStatusIdsParams
  ): Promise<MediaWithAttachedStatusIds | null>
  markMediaUploadVerified(
    params: MarkMediaUploadVerifiedParams
  ): Promise<MarkMediaUploadVerifiedResult | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  updateAttachmentPlayback(
    params: UpdateAttachmentPlaybackParams
  ): Promise<boolean>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
  // Replaces the status's remote attachments (no media row, not a fitness
  // file) with `attachments`, in one transaction.
  replaceRemoteAttachmentsForStatus(
    params: ReplaceRemoteAttachmentsForStatusParams
  ): Promise<void>
  getAttachmentsWithMedia(
    params: GetAttachmentsWithMediaParams
  ): Promise<AttachmentWithMedia[]>
  getAttachmentsForActor(
    params: GetAttachmentsForActorParams
  ): Promise<Attachment[]>
  getMediasWithStatusForAccount(
    params: GetMediasForAccountParams
  ): Promise<PaginatedMediaWithStatus>
  getMediaByIdForAccount(params: GetMediaByIdParams): Promise<Media | null>
  getMediaByIdsForAccount(
    params: GetMediaByIdsForAccountParams
  ): Promise<Media[]>
  updateMedia(params: UpdateMediaParams): Promise<UpdateMediaResult | null>
  getStorageUsageForAccount(
    params: GetStorageUsageForAccountParams
  ): Promise<number>
  deleteAttachmentsByIds(params: DeleteAttachmentsByIdsParams): Promise<number>
  deleteMedia(params: DeleteMediaParams): Promise<boolean>
  // Unscoped delete, like `deleteMedia`, that also returns every stored path
  // the row kept so the caller can delete the files after the commit.
  deleteMediaWithFiles(
    params: DeleteMediaParams
  ): Promise<DeleteMediaWithFilesResult>
  // Owner-scoped delete that only removes media not yet attached to a status.
  // Returns `not-found` when missing/owned by another account, `in-use` when
  // already attached to a posted status, and `deleted` on success.
  deleteMediaForAccount(
    params: DeleteMediaForAccountParams
  ): Promise<DeleteMediaForAccountResult>
}
