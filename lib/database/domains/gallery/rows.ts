// Pure helpers for the gallery domain's rows, shared by its Kysely queries
// (./queries.ts, ./media.ts, ./lookupCache.ts, ./albumSuggestions.ts and
// ./albums.ts). No database access. The parsers accept both the Kysely and the
// Knex row shapes: a timestamp as epoch ms, a Date or SQLite text, a JSON
// column as text or parsed, a boolean as 0/1 or a boolean.
import type { GalleryIndexRow } from '@/lib/database/domains/gallery/types'
import {
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parsePlaceNameSource,
  parseTaxonPath,
  toMediaRowId
} from '@/lib/database/domains/media/rows'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { parseGalleryHiddenLocations } from '@/lib/services/gallery/hiddenLocations'
import { MEDIA_FILE_URL_PATH } from '@/lib/services/medias/mediaFileUrl'
import {
  DEFAULT_GALLERY_SETTINGS,
  GALLERY_DEFAULTS,
  GalleryDefault,
  GalleryGear,
  GalleryHiddenLocation,
  GallerySettings,
  MAX_SUBJECT_CONFIDENCE_THRESHOLD,
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES,
  MIN_SUBJECT_CONFIDENCE_THRESHOLD,
  MediaPlacePrecision,
  MediaSubjectCategory,
  SQLGalleryGear,
  SQLGallerySettings,
  SUBJECT_CONFIDENCE_THRESHOLD_STEP,
  SUBJECT_SUGGESTION_MODES,
  SubjectSuggestionMode
} from '@/lib/types/database/gallery'
import { Attachment } from '@/lib/types/domain/attachment'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** A row count from a caller: a non-negative integer, 0 for anything else. */
export const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

/** Epoch milliseconds, or null for a missing or unparseable time. */
export const parseNullableTime = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const time = getCompatibleTime(value as number | string | Date)
  return Number.isFinite(time) ? time : null
}

/** The distinct `medias.id`s among `mediaIds`; anything else is dropped. */
export const toRowIds = (mediaIds: Array<string | number>): number[] => [
  ...new Set(
    mediaIds
      .map((id) => toMediaRowId(String(id)))
      .filter((id): id is number => id !== null)
  )
]

/** Sorts `rows` in place by their numeric id, highest first. */
export const sortByIdDesc = <T>(
  rows: T[],
  getId: (row: T) => string | number
) => rows.sort((a, b) => Number(getId(b)) - Number(getId(a)))

export const isPresent = (value: unknown) =>
  value !== null && value !== undefined && value !== ''

// ---------------------------------------------------------------------------
// Gallery media
// ---------------------------------------------------------------------------

export const parseCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseCategory = (value: unknown): MediaSubjectCategory | null =>
  typeof value === 'string' &&
  (MEDIA_SUBJECT_CATEGORIES as readonly string[]).includes(value)
    ? (value as MediaSubjectCategory)
    : null

export const parsePrecision = (value: unknown): MediaPlacePrecision | null =>
  typeof value === 'string' &&
  (MEDIA_PLACE_PRECISIONS as readonly string[]).includes(value)
    ? (value as MediaPlacePrecision)
    : null

/** The columns `GalleryIndexRow` is read from, parsed. */
export const GALLERY_INDEX_COLUMNS = [
  'id',
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'subjectTaxonKey',
  'subjectTaxonPath',
  'subjectIucnCategory',
  'subjectLookupStatus',
  'placeName',
  'placePrecision',
  'placeLatitude',
  'placeLongitude',
  'placeCountryCode',
  'placeNameSource',
  'takenAt',
  'createdAt'
] as const

export const toGalleryIndexRow = (
  row: Record<string, unknown>
): GalleryIndexRow => ({
  id: String(row.id),
  subjectName: (row.subjectName as string | null) ?? null,
  subjectScientificName: (row.subjectScientificName as string | null) ?? null,
  subjectCategory: parseCategory(row.subjectCategory),
  subjectTaxonKey: (row.subjectTaxonKey as string | null) ?? null,
  subjectTaxonPath: parseTaxonPath(row.subjectTaxonPath),
  subjectIucnCategory: parseIucnCategory(row.subjectIucnCategory),
  subjectLookupStatus: parseLookupStatus(row.subjectLookupStatus),
  placeName: (row.placeName as string | null) ?? null,
  placePrecision: parsePrecision(row.placePrecision),
  placeLatitude: parseCoordinate(row.placeLatitude),
  placeLongitude: parseCoordinate(row.placeLongitude),
  placeCountryCode: parseCountryCode(row.placeCountryCode),
  placeNameSource: parsePlaceNameSource(row.placeNameSource),
  takenAt: parseNullableTime(row.takenAt),
  createdAt: parseNullableTime(row.createdAt) ?? 0
})

/**
 * An `attachments` row read with the media it shows (see `pickAttachments` in
 * ./media.ts): the attachment's own columns, plus the status's public id, the
 * media id and the media's live file under `gallery*` aliases.
 */
export type GalleryAttachmentRow = Record<string, unknown> & {
  galleryMediaId: string | number
  galleryStatusPublicId: string | null
}

export const parseGalleryAttachmentRow = (
  row: GalleryAttachmentRow
): Attachment | null => {
  const parsed = Attachment.safeParse({
    id: row.id,
    actorId: row.actorId,
    statusId: row.statusId,
    type: row.type ?? 'Document',
    mediaType: row.mediaType,
    url: row.url,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    name: row.name ?? '',
    mediaId:
      row.mediaId === null || row.mediaId === undefined
        ? null
        : String(row.mediaId),
    blurhash: row.blurhash ?? undefined,
    focus:
      row.focusX !== null &&
      row.focusX !== undefined &&
      row.focusY !== null &&
      row.focusY !== undefined
        ? { x: Number(row.focusX), y: Number(row.focusY) }
        : undefined,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    playbackType: row.playbackType ?? undefined,
    createdAt: getCompatibleTime(row.createdAt as number | string | Date),
    updatedAt: getCompatibleTime(row.updatedAt as number | string | Date)
  })
  return parsed.success ? parsed.data : null
}

const parseLiveNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A photo is shown in the gallery as it is NOW: the url, size, BlurHash and
 * focal point come from its `medias` row, not from the snapshot the post took
 * when it was published. A photo edited "Gallery only" changes in the gallery
 * while its post keeps showing the file it was posted with. The attachment
 * still decides who may see the photo and which post it links to. Only a
 * still image stored here is switched: the url keeps the attachment's own
 * origin and swaps the stored path after `/api/v1/files/`.
 */
export const withLiveFile = (
  attachment: Attachment,
  row: GalleryAttachmentRow
): Attachment => {
  const livePath = row.galleryLivePath
  if (typeof livePath !== 'string' || !livePath) return attachment
  if (!attachment.mediaType.startsWith('image/')) return attachment
  if (attachment.mediaType === 'image/gif') return attachment
  const pathIndex = attachment.url.indexOf(MEDIA_FILE_URL_PATH)
  if (pathIndex < 0) return attachment

  let metaData: Record<string, unknown> | null = null
  try {
    metaData = getCompatibleJSON<Record<string, unknown>>(
      (row.galleryLiveMetaData as string | Record<string, unknown> | null) ?? {}
    )
  } catch {
    // A corrupt row keeps the size the post recorded.
  }
  const width = parseLiveNumber(metaData?.width)
  const height = parseLiveNumber(metaData?.height)
  const focusX = parseLiveNumber(row.galleryLiveFocusX)
  const focusY = parseLiveNumber(row.galleryLiveFocusY)
  const blurhash = row.galleryLiveBlurhash
  return {
    ...attachment,
    url: `${attachment.url.slice(0, pathIndex)}${MEDIA_FILE_URL_PATH}${livePath}`,
    ...(width !== null && height !== null ? { width, height } : {}),
    blurhash: typeof blurhash === 'string' && blurhash ? blurhash : null,
    focus: focusX !== null && focusY !== null ? { x: focusX, y: focusY } : null,
    // A thumbnail the post snapshotted shows the photo as it was uploaded, so
    // an edited photo has none (as `getLiveThumbnail`) and the tile, subject
    // card and map fall back to the live file.
    ...(row.galleryLiveEditedAt != null ? { thumbnailUrl: null } : {})
  }
}

// ---------------------------------------------------------------------------
// Gear and settings
// ---------------------------------------------------------------------------

/** Trims, collapses whitespace runs and lowercases a gear name. */
export const normalizeGalleryGearName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase()

// A Kysely `gallery_gears` row as the shared parser types it.
export const asGalleryGearRow = (row: object) => row as SQLGalleryGear

export const parseSQLGalleryGear = (row: SQLGalleryGear): GalleryGear => ({
  id: row.id,
  actorId: row.actorId,
  kind: row.kind,
  name: row.name,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  productUrl: row.productUrl ?? undefined,
  deviceKey: row.deviceKey ?? undefined,
  retiredAt: row.retiredAt ? getCompatibleTime(row.retiredAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

// A missing, corrupt or hand-edited column reads as the zones that survive
// `parseGalleryHiddenLocations`, never as a raw blob: every public projection
// trusts this shape.
const parseHiddenLocations = (
  value: string | null | undefined
): GalleryHiddenLocation[] => {
  if (!value) return []
  try {
    return parseGalleryHiddenLocations(JSON.parse(value))
  } catch {
    return []
  }
}

const parseSubjectConfidenceThreshold = (value: unknown): number => {
  const threshold = Number(value)
  return Number.isInteger(threshold) &&
    threshold >= MIN_SUBJECT_CONFIDENCE_THRESHOLD &&
    threshold <= MAX_SUBJECT_CONFIDENCE_THRESHOLD &&
    threshold % SUBJECT_CONFIDENCE_THRESHOLD_STEP === 0
    ? threshold
    : DEFAULT_GALLERY_SETTINGS.subjectConfidenceThreshold
}

// A Kysely `gallery_settings` row as the shared parser types it.
export const asGallerySettingsRow = (row: object) => row as SQLGallerySettings

export const parseSQLGallerySettings = (
  row: SQLGallerySettings
): GallerySettings => ({
  autoDescribe: Boolean(row.autoDescribe),
  allowEmptyDescription: Boolean(row.allowEmptyDescription),
  subjectHashtags: Boolean(row.subjectHashtags),
  galleryDefault: (GALLERY_DEFAULTS as readonly string[]).includes(
    row.galleryDefault
  )
    ? (row.galleryDefault as GalleryDefault)
    : DEFAULT_GALLERY_SETTINGS.galleryDefault,
  defaultPlacePrecision: (MEDIA_PLACE_PRECISIONS as readonly string[]).includes(
    row.defaultPlacePrecision
  )
    ? (row.defaultPlacePrecision as MediaPlacePrecision)
    : DEFAULT_GALLERY_SETTINGS.defaultPlacePrecision,
  showGear: Boolean(row.showGear),
  mapPublic: Boolean(row.mapPublic),
  lifeListPublic: Boolean(row.lifeListPublic),
  hiddenLocations: parseHiddenLocations(row.hiddenLocations),
  // Fails closed: a missing value is the default, on. Only an explicit false
  // (0 on SQLite) turns the threatened-species rule off.
  hideThreatenedPlaces:
    row.hideThreatenedPlaces === null || row.hideThreatenedPlaces === undefined
      ? DEFAULT_GALLERY_SETTINGS.hideThreatenedPlaces
      : Boolean(row.hideThreatenedPlaces),
  subjectSuggestionMode: (
    SUBJECT_SUGGESTION_MODES as readonly string[]
  ).includes(row.subjectSuggestionMode ?? '')
    ? (row.subjectSuggestionMode as SubjectSuggestionMode)
    : DEFAULT_GALLERY_SETTINGS.subjectSuggestionMode,
  subjectConfidenceThreshold: parseSubjectConfidenceThreshold(
    row.subjectConfidenceThreshold
  ),
  // A missing value is the default, on.
  photoEnhance:
    row.photoEnhance === null || row.photoEnhance === undefined
      ? DEFAULT_GALLERY_SETTINGS.photoEnhance
      : Boolean(row.photoEnhance)
})
