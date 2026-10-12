// Pure helpers for `medias` rows, shared by the Kysely media reads and writes
// (./queries.ts, ./writes.ts), the photo editor (domains/mediaEdit) and the
// Knex code that has not moved yet
// (lib/services/gallery/galleryQueries.ts). No database access. The Knex
// callers hand over Knex rows, so the parsers accept both row shapes: a
// timestamp as epoch ms, a Date or SQLite text, a JSON column as text or
// parsed, a boolean as 0/1 or a boolean, an int8 as a string or a number.
import type { Media } from '@/lib/database/domains/media/types'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import {
  EMPTY_MEDIA_DETAILS,
  IUCN_CATEGORIES,
  IucnCategory,
  MEDIA_LOOKUP_STATUSES,
  MEDIA_PLACE_NAME_SOURCES,
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES,
  MediaDetailsRecord,
  MediaExposure,
  MediaLookupStatus,
  MediaPlaceNameSource,
  MediaPlacePrecision,
  MediaSubjectCategory,
  MediaSubjectSuggestions
} from '@/lib/types/database/gallery'

// PostgreSQL `integer` upper bound. An id above it does not merely miss: the
// driver sends it as a parameter to an integer column and PostgreSQL answers
// `value out of range for type integer` — the same 500 a non-numeric id caused.
// The repo's own attachments.mediaId migration bounds at this exact value.
export const MAX_MEDIA_ROW_ID = 2147483647

// `medias.id` is an integer column. Mastodon clients send ids as strings and
// put whatever they like in them, so coerce before comparing: PostgreSQL
// rejects an integer column compared against text with `invalid input syntax
// for type integer`, which turns a miss into a 500 rather than a 404. SQLite's
// dynamic typing merely matches nothing, which is why this only ever showed up
// on PostgreSQL. Returns null for anything that is not a plain decimal row id
// so the caller can report "not found" without touching the database.
//
// Accepted is exactly: optional leading zeros, one or more digits, an optional
// all-zero fraction, and a value in 1..2147483647. Everything else is a miss.
//
// That is deliberately TIGHTER than what the backends themselves accept, so on
// PostgreSQL this is a behaviour change and not only a bug fix. Measured
// against PostgreSQL 17 and SQLite through the drivers this app uses:
//
//   spelling       PostgreSQL 17           SQLite       here
//   '0012'         row 12                  row 12       row 12   unchanged
//   '12.0'         invalid input syntax    row 12       row 12   500 -> hit
//   '+12', ' 12 '  row 12                  row 12       404      TIGHTENED
//   '0x10'         row 16                  no match     404      TIGHTENED
//   '1e3'          invalid input syntax    row 1000     404      500 -> 404
//   '2147483648'   value out of range      no match     404      500 -> 404
//   'abc'          invalid input syntax    no match     404      500 -> 404
//
// The tightening is intended: a media id is a row id, and Mastodon answers 404
// for anything that is not one. PostgreSQL resolving '0x10' to media 16 is an
// accident of it accepting non-decimal integer literals since 16 — a client
// asking for '0x10' did not ask for media 16. Note '1e21' additionally
// round-trips back as the string '1e+21' (the driver stringifies with
// `toString()`), so a bare `Number()` guard reproduces the very error this
// exists to prevent.
//
// '12.0' is the one spelling kept for compatibility rather than tightened away.
// It resolved on SQLite before this guard existed, and it used to be reachable
// from stored data there: `attachments.mediaId` was a `varchar`, where an id
// bound as a JS number landed as '1.0' and was then re-resolved on every status
// edit. The column is an integer now, so nothing stores that spelling any more;
// it stays accepted because a client may still send it.
export const toMediaRowId = (mediaId: string): number | null => {
  if (!/^\d+(\.0+)?$/.test(mediaId)) return null
  const id = Number(mediaId)
  return id > 0 && id <= MAX_MEDIA_ROW_ID ? id : null
}

// The `attachments.mediaId` value for a media id the domain carries as a
// string (an integer column on both backends, like `medias.id`; the domain
// keeps media ids as strings, as the API does). Nothing is stored for a missing
// id. A write, unlike a comparison, cannot treat a bad id as a miss: coercing
// it to null would silently drop the link rather than surface the caller's
// mistake, so an id that is not a row id is an error. `toMediaRowId` also admits
// '12.0' and '012', which are written as 12.
export const toAttachmentMediaId = (
  mediaId: string | null | undefined
): number | null => {
  if (mediaId === null || mediaId === undefined) return null
  const id = toMediaRowId(mediaId)
  if (id === null) {
    throw new Error(`Invalid media id: ${JSON.stringify(mediaId.slice(0, 40))}`)
  }
  return id
}

export type MediaRow = {
  id: string | number
  actorId: string
  original: string
  originalBytes: number | string | bigint
  originalMimeType: string
  originalMetaData: string
  originalFileName?: string | null
  thumbnail?: string | null
  thumbnailBytes?: number | string | bigint | null
  thumbnailMimeType?: string | null
  thumbnailMetaData?: string | null
  description?: string | null
  focusX?: number | string | null
  focusY?: number | string | null
  blurhash?: string | null
  subjectName?: string | null
  subjectScientificName?: string | null
  subjectCategory?: string | null
  takenAt?: number | string | Date | null
  cameraGearId?: string | null
  lensGearId?: string | null
  exposure?: string | MediaExposure | null
  placeName?: string | null
  placeLatitude?: number | string | null
  placeLongitude?: number | string | null
  placePrecision?: string | null
  inGallery?: boolean | number | null
  subjectTaxonKey?: string | null
  subjectTaxonPath?: string | null
  subjectIucnCategory?: string | null
  subjectLookupStatus?: string | null
  subjectLookupAt?: number | string | Date | null
  subjectSuggestions?: string | null
  placeCountryCode?: string | null
  placeNameSource?: string | null
  placeLookupStatus?: string | null
  placeLookupAt?: number | string | Date | null
  editVersion?: number | string | null
  editedAt?: number | string | Date | null
  // When the owner added it in Gallery; null for an upload nobody kept.
  galleryAddedAt?: number | string | Date | null
}

export type MediaMetaData = Media['original']['metaData']

export const parseMediaMetaData = (
  input?: string | MediaMetaData | null
): MediaMetaData =>
  getCompatibleJSON<MediaMetaData>(input ?? ({} as MediaMetaData))

const parseNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseMediaExposure = (
  input: string | MediaExposure | null | undefined
): MediaExposure | null => {
  if (!input) return null
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      // A corrupt blob is treated as "no exposure": the column is display-only.
      return null
    }
  }
  if (!value || typeof value !== 'object') return null

  const { focalLengthMm, aperture, exposureTime, iso } = value as Record<
    string,
    unknown
  >
  const exposure: MediaExposure = {
    ...(typeof focalLengthMm === 'number' ? { focalLengthMm } : {}),
    ...(typeof aperture === 'number' ? { aperture } : {}),
    ...(typeof exposureTime === 'string' && exposureTime
      ? { exposureTime }
      : {}),
    ...(typeof iso === 'number' ? { iso } : {})
  }
  return Object.keys(exposure).length > 0 ? exposure : null
}

const parseEnum = <T extends string>(
  values: readonly T[],
  value: unknown
): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : null

// An unknown category or status reads as null. For the threatened-species
// rule null is "not cleared", so a corrupt value fails closed.
export const parseIucnCategory = (value: unknown): IucnCategory | null =>
  parseEnum(IUCN_CATEGORIES, value)

export const parseLookupStatus = (value: unknown): MediaLookupStatus | null =>
  parseEnum(MEDIA_LOOKUP_STATUSES, value)

export const parsePlaceNameSource = (
  value: unknown
): MediaPlaceNameSource | null => parseEnum(MEDIA_PLACE_NAME_SOURCES, value)

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
export const parseCountryCode = (value: unknown): string | null =>
  typeof value === 'string' && COUNTRY_CODE_PATTERN.test(value) ? value : null

// `subjectTaxonPath` holds at most 7 names of at most 64 characters.
export const MAX_TAXON_PATH_LENGTH = 7
export const MAX_TAXON_NAME_LENGTH = 64

export const toTaxonPath = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  const names = value
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().slice(0, MAX_TAXON_NAME_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TAXON_PATH_LENGTH)
  return names.length > 0 ? names : null
}

export const parseTaxonPath = (value: unknown): string[] | null => {
  if (typeof value !== 'string' || !value) return null
  try {
    return toTaxonPath(JSON.parse(value))
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

// The stored suggestions are re-validated on read: a hand-edited or truncated
// blob reads as "no suggestions", never as half a structure.
export const parseSubjectSuggestions = (
  value: unknown
): MediaSubjectSuggestions | null => {
  if (typeof value !== 'string' || !value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (typeof parsed.model !== 'string' || !Array.isArray(parsed.candidates)) {
    return null
  }
  const candidates = parsed.candidates.flatMap(
    (candidate): MediaSubjectSuggestions['candidates'] => {
      if (!isRecord(candidate) || typeof candidate.name !== 'string') return []
      const category = parseEnum(MEDIA_SUBJECT_CATEGORIES, candidate.category)
      if (!category) return []
      const confidence = Number(candidate.confidence)
      return [
        {
          name: candidate.name,
          scientificName: toNullableString(candidate.scientificName),
          category,
          confidence: Number.isFinite(confidence)
            ? Math.min(1, Math.max(0, confidence))
            : 0,
          taxonKey: toNullableString(candidate.taxonKey),
          rank: toNullableString(candidate.rank),
          taxonPath: toTaxonPath(candidate.taxonPath) ?? []
        }
      ]
    }
  )
  return {
    model: parsed.model,
    generatedAt:
      typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    checkedAgainst: parsed.checkedAgainst === 'gbif' ? 'gbif' : null,
    candidates,
    group: parseEnum(MEDIA_SUBJECT_CATEGORIES, parsed.group)
  }
}

export const parseMediaDetails = (data: MediaRow): MediaDetailsRecord => ({
  ...EMPTY_MEDIA_DETAILS,
  subjectName: data.subjectName ?? null,
  subjectScientificName: data.subjectScientificName ?? null,
  subjectCategory: (MEDIA_SUBJECT_CATEGORIES as readonly string[]).includes(
    data.subjectCategory ?? ''
  )
    ? (data.subjectCategory as MediaSubjectCategory)
    : null,
  takenAt: data.takenAt ? getCompatibleTime(data.takenAt) : null,
  cameraGearId: data.cameraGearId ?? null,
  lensGearId: data.lensGearId ?? null,
  exposure: parseMediaExposure(data.exposure),
  placeName: data.placeName ?? null,
  placeLatitude: parseNullableNumber(data.placeLatitude),
  placeLongitude: parseNullableNumber(data.placeLongitude),
  placePrecision: (MEDIA_PLACE_PRECISIONS as readonly string[]).includes(
    data.placePrecision ?? ''
  )
    ? (data.placePrecision as MediaPlacePrecision)
    : null,
  // SQLite hands the boolean back as 0/1.
  inGallery: Boolean(data.inGallery),
  subjectTaxonKey: data.subjectTaxonKey ?? null,
  subjectTaxonPath: parseTaxonPath(data.subjectTaxonPath),
  subjectIucnCategory: parseIucnCategory(data.subjectIucnCategory),
  subjectLookupStatus: parseLookupStatus(data.subjectLookupStatus),
  subjectLookupAt: data.subjectLookupAt
    ? getCompatibleTime(data.subjectLookupAt)
    : null,
  subjectSuggestions: parseSubjectSuggestions(data.subjectSuggestions),
  placeCountryCode: parseCountryCode(data.placeCountryCode),
  placeNameSource: parsePlaceNameSource(data.placeNameSource),
  placeLookupStatus: parseLookupStatus(data.placeLookupStatus),
  placeLookupAt: data.placeLookupAt
    ? getCompatibleTime(data.placeLookupAt)
    : null
})

export const parseMediaRow = (data: MediaRow): Media => ({
  id: String(data.id),
  actorId: data.actorId,
  original: {
    path: data.original,
    bytes: Number(data.originalBytes),
    mimeType: data.originalMimeType,
    metaData: parseMediaMetaData(data.originalMetaData),
    ...(data.originalFileName ? { fileName: data.originalFileName } : {})
  },
  ...(data.thumbnail
    ? {
        thumbnail: {
          path: data.thumbnail,
          bytes: Number(data.thumbnailBytes),
          mimeType: data.thumbnailMimeType ?? '',
          metaData: parseMediaMetaData(data.thumbnailMetaData)
        }
      }
    : {}),
  ...(data.description ? { description: data.description } : {}),
  ...(data.focusX !== null &&
  data.focusX !== undefined &&
  data.focusY !== null &&
  data.focusY !== undefined
    ? { focus: { x: Number(data.focusX), y: Number(data.focusY) } }
    : {}),
  ...(data.blurhash ? { blurhash: data.blurhash } : {}),
  details: parseMediaDetails(data),
  ...(data.editVersion !== undefined
    ? {
        edit: {
          version: Number(data.editVersion ?? 0),
          editedAt: data.editedAt ? getCompatibleTime(data.editedAt) : null
        }
      }
    : {})
})

// `medias` columns needed to rebuild a full Media row (used by every read).
export const MEDIA_COLUMNS = [
  'id',
  'actorId',
  'original',
  'originalBytes',
  'originalMimeType',
  'originalMetaData',
  'originalFileName',
  'thumbnail',
  'thumbnailBytes',
  'thumbnailMimeType',
  'thumbnailMetaData',
  'description',
  'focusX',
  'focusY',
  'blurhash',
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'takenAt',
  'cameraGearId',
  'lensGearId',
  'exposure',
  'placeName',
  'placeLatitude',
  'placeLongitude',
  'placePrecision',
  'inGallery',
  'subjectTaxonKey',
  'subjectTaxonPath',
  'subjectIucnCategory',
  'subjectLookupStatus',
  'subjectLookupAt',
  'subjectSuggestions',
  'placeCountryCode',
  'placeNameSource',
  'placeLookupStatus',
  'placeLookupAt',
  'editVersion',
  'editedAt',
  'galleryAddedAt'
] as const

// `medias.<column>` for every column parseMediaRow reads, for a Kysely query
// that joins `medias` to another table. The rows come back keyed by the bare
// column name, as they did from Knex.
export const MEDIA_SELECT = MEDIA_COLUMNS.map(
  (column) => `medias.${column}` as const
)

// A Kysely `medias` row as the shared parser types it. The driver has already
// normalised timestamps, JSON, booleans and int8; the parser accepts both
// those and the raw Knex values.
export const asMediaRow = (row: object) => row as MediaRow
