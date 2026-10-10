import { Knex } from 'knex'

import {
  lockGalleryAlbumActor,
  removeMediaFromGalleryAlbums
} from '@/lib/database/sql/galleryAlbumCleanup'
import { buildActorVisibleStatusIdsQuery } from '@/lib/database/sql/status'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { isSpeciesLike } from '@/lib/services/gallery/threatenedSpecies'
import {
  EMPTY_MEDIA_DETAILS,
  IUCN_CATEGORIES,
  IucnCategory,
  MAX_SUBJECT_SUGGESTIONS_BYTES,
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
import {
  AttachmentWithMedia,
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteAttachmentsByIdsParams,
  DeleteMediaForAccountParams,
  DeleteMediaForAccountResult,
  DeleteMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetAttachmentsWithMediaParams,
  GetMediaByIdParams,
  GetMediaByIdsForAccountParams,
  GetMediaWithAttachedStatusIdsParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  MarkMediaUploadVerifiedParams,
  MarkMediaUploadVerifiedResult,
  Media,
  MediaDatabase,
  MediaWithAttachedStatusIds,
  PaginatedMediaWithStatus,
  SetMediaPlaceLookupParams,
  SetMediaSubjectLookupParams,
  SetMediaSubjectSuggestionsParams,
  UpdateAttachmentPlaybackParams,
  UpdateMediaDetailsParams,
  UpdateMediaParams,
  UpdateMediaResult
} from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'

import { getCompatibleJSON } from './utils/getCompatibleJSON'
import { getCompatibleTime } from './utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize, isPostgresClient } from './utils/knex'

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
// '12.0' is the one spelling kept for compatibility rather than tightened away,
// and it is a SQLite concern: `attachments.mediaId` is `varchar` there, so an id
// bound as a JS number lands as '1.0' through REAL->TEXT conversion and is then
// re-resolved on every status edit. No production writer does that today — they
// all stringify, and the #307 backfill copies an INTEGER, which TEXT affinity
// renders as '1' (both verified) — and `createMedia` no longer returns a raw
// number. So it is defence in depth for a form nothing is known to have
// written, not a shim for observed data. On PostgreSQL it was a 500 before.
export const toMediaRowId = (mediaId: string): number | null => {
  if (!/^\d+(\.0+)?$/.test(mediaId)) return null
  const id = Number(mediaId)
  return id > 0 && id <= MAX_MEDIA_ROW_ID ? id : null
}

// Gallery reads compare `attachments.mediaId` with the TEXT form of
// `medias.id` on SQLite so `attachments_mediaId_idx` stays usable, so what is
// written must be the plain `String(id)`. `toMediaRowId` also admits '12.0' and
// '012' (the outbox route only shape-checks), which would otherwise be stored
// verbatim and vanish from the gallery. Anything it rejects is left untouched so
// a bad id still surfaces instead of silently dropping the link.
const toCanonicalMediaId = <T extends string | null | undefined>(
  mediaId: T
): T | string => {
  if (typeof mediaId !== 'string') return mediaId
  const id = toMediaRowId(mediaId)
  return id === null ? mediaId : String(id)
}

const deleteMediaByConditions = async (
  database: Knex,
  conditions: Record<string, string | number>
): Promise<boolean> => {
  return database.transaction(async (trx) => {
    const media = await trx('medias')
      .where(conditions)
      .select('id', 'actorId', 'originalBytes', 'thumbnailBytes')
      .first<{
        id: string | number
        actorId: string
        originalBytes: number | string | bigint | null
        thumbnailBytes: number | string | bigint | null
      }>()
    if (!media) return false

    const actor = await trx('actors')
      .where('id', media.actorId)
      .select<{ accountId: string | null }>('accountId')
      .first()

    // The owner's album lock first, then the album rows, then the media row:
    // the same order every album write takes.
    await lockGalleryAlbumActor(trx, media.actorId)
    await removeMediaFromGalleryAlbums(trx, Number(media.id))
    const deleted = await trx('medias')
      .where({ ...conditions, id: media.id })
      .del()
    if (!deleted) return false

    const usageDelta =
      parseCounterValue(media.originalBytes) +
      parseCounterValue(media.thumbnailBytes)

    if (actor?.accountId) {
      if (usageDelta > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(actor.accountId),
          usageDelta
        )
      }
      await decreaseCounterValue(trx, CounterKey.totalMedia(actor.accountId), 1)
    }
    return true
  })
}

const deleteMediaById = async (
  database: Knex,
  mediaId: string
): Promise<boolean> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return false
  return deleteMediaByConditions(database, { id })
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
  // When the owner added it in Gallery; null for an upload nobody kept.
  galleryAddedAt?: number | string | Date | null
}

type MediaMetaData = Media['original']['metaData']

const parseMediaMetaData = (
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

const toTaxonPath = (value: unknown): string[] | null => {
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

const parseMediaDetails = (data: MediaRow): MediaDetailsRecord => ({
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
  details: parseMediaDetails(data)
})

// Maps the details an update or create may write to `medias` columns. Presence
// semantics: only keys present in `details` produce a column, so a partial
// update never blanks a column the caller did not mention.
//
// `current` is the row as it stands (EMPTY for a create), read in the same
// transaction as the write. It decides the lookup resets, which go in the same
// update as the edit so no reader ever sees a new subject with the old
// subject's IUCN verdict:
// - a subject that CHANGES (name, scientific name, category or taxon key)
//   clears the IUCN category and taxon path, and sets the lookup status to
//   `pending` when the new subject is species-like (null otherwise), with
//   `subjectLookupAt` as the time it became pending (null otherwise).
//   A name or scientific-name change without a taxon key also clears the old
//   key: it named the previous species, and resolving it would clear the new
//   subject against the wrong taxon.
// - coordinates that CHANGE clear the country code and a geocoded name the
//   request did not replace, since it named the previous point, and set the
//   place lookup status to `pending` (null when the point was cleared), with
//   `placeLookupAt` as the time it became pending.
// - a place name that changes is the owner's (`placeNameSource = 'owner'`);
//   clearing it clears the source, so the geocoder may fill it again.
// Re-sending the stored values changes nothing, so re-saving the dialog does
// not throw away a finished lookup.
const getDetailsColumns = (
  details: UpdateMediaDetailsParams | undefined,
  current: MediaDetailsRecord = EMPTY_MEDIA_DETAILS
): Record<string, unknown> => {
  if (!details) return {}
  const columns: Record<string, unknown> = {}
  if ('subjectTaxonKey' in details) {
    columns.subjectTaxonKey = details.subjectTaxonKey?.trim() || null
  }
  if ('subjectName' in details)
    columns.subjectName = details.subjectName ?? null
  if ('subjectScientificName' in details) {
    columns.subjectScientificName = details.subjectScientificName ?? null
  }
  if ('subjectCategory' in details) {
    columns.subjectCategory = details.subjectCategory ?? null
  }
  if ('takenAt' in details) {
    columns.takenAt =
      details.takenAt === null || details.takenAt === undefined
        ? null
        : new Date(details.takenAt)
  }
  if ('cameraGearId' in details) {
    columns.cameraGearId = details.cameraGearId ?? null
  }
  if ('lensGearId' in details) columns.lensGearId = details.lensGearId ?? null
  if ('exposure' in details) {
    columns.exposure = details.exposure
      ? JSON.stringify(details.exposure)
      : null
  }
  if ('placeName' in details) columns.placeName = details.placeName ?? null
  if ('placeLatitude' in details) {
    columns.placeLatitude = details.placeLatitude ?? null
  }
  if ('placeLongitude' in details) {
    columns.placeLongitude = details.placeLongitude ?? null
  }
  if ('placePrecision' in details) {
    columns.placePrecision = details.placePrecision ?? null
  }
  if (details.inGallery !== undefined) columns.inGallery = details.inGallery

  const subjectChanged = (
    [
      'subjectName',
      'subjectScientificName',
      'subjectCategory',
      'subjectTaxonKey'
    ] as const
  ).some((key) => key in columns && columns[key] !== current[key])
  if (subjectChanged) {
    const nameChanged = (
      ['subjectName', 'subjectScientificName'] as const
    ).some((key) => key in columns && columns[key] !== current[key])
    if (nameChanged && !('subjectTaxonKey' in columns)) {
      columns.subjectTaxonKey = null
    }
    const pick = <K extends keyof MediaDetailsRecord>(key: K) =>
      (key in columns ? columns[key] : current[key]) as MediaDetailsRecord[K]
    const next = {
      subjectName: pick('subjectName'),
      subjectScientificName: pick('subjectScientificName'),
      subjectCategory: pick('subjectCategory'),
      subjectTaxonKey: pick('subjectTaxonKey')
    }
    columns.subjectTaxonPath = null
    columns.subjectIucnCategory = null
    const speciesLike = isSpeciesLike(next)
    columns.subjectLookupStatus = speciesLike ? 'pending' : null
    // For `pending`, when it started: the owner is offered a Retry once a
    // lookup has been pending too long (a lost job, a queue outage).
    columns.subjectLookupAt = speciesLike ? new Date() : null
  }

  const coordinatesChanged = (
    ['placeLatitude', 'placeLongitude'] as const
  ).some((key) => key in columns && columns[key] !== current[key])
  if (coordinatesChanged) {
    const latitude =
      'placeLatitude' in columns ? columns.placeLatitude : current.placeLatitude
    const longitude =
      'placeLongitude' in columns
        ? columns.placeLongitude
        : current.placeLongitude
    const hasPoint =
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined
    columns.placeCountryCode = null
    // A point is looked up whenever it is set or moved (the upload and the
    // update publish the lookup after this commits), so it is `pending` from
    // here, with the time it became pending: the dialog says it is being
    // looked up, and offers a Retry once that has taken too long (a lost
    // job, a queue outage). With no point there is nothing to look up.
    columns.placeLookupStatus = hasPoint ? 'pending' : null
    columns.placeLookupAt = hasPoint ? new Date() : null
    if (!('placeName' in columns) && current.placeNameSource === 'geocoder') {
      columns.placeName = null
      columns.placeNameSource = null
    }
  }
  if ('placeName' in columns && columns.placeName !== current.placeName) {
    columns.placeNameSource = columns.placeName === null ? null : 'owner'
  }
  return columns
}

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
  'galleryAddedAt'
] as const

// `column = value`, or `column IS NULL` for a null value: SQL's `= NULL` is
// never true, so a plain `where` would make every null expectation a miss.
const whereNullSafe = (
  query: Knex.QueryBuilder,
  column: string,
  value: string | number | null
) => {
  if (value === null) query.whereNull(column)
  else query.where(column, value)
  return query
}

export const MediaSQLDatabaseMixin = (database: Knex): MediaDatabase => ({
  async createMedia({
    actorId,
    original,
    thumbnail,
    description,
    focus,
    blurhash,
    details
  }: CreateMediaParams) {
    if (!actorId) return null

    return database.transaction(async (trx) => {
      const actor = await trx('actors')
        .where('id', actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const content = {
        actorId,
        original: original.path,
        originalBytes: original.bytes,
        originalMimeType: original.mimeType,
        originalMetaData: JSON.stringify(original.metaData),
        ...(original.fileName ? { originalFileName: original.fileName } : null),
        ...(thumbnail
          ? {
              thumbnail: thumbnail.path,
              thumbnailBytes: thumbnail.bytes,
              thumbnailMimeType: thumbnail.mimeType,
              thumbnailMetaData: JSON.stringify(thumbnail.metaData)
            }
          : null),
        ...(description ? { description } : null),
        ...(focus ? { focusX: focus.x, focusY: focus.y } : null),
        ...(blurhash ? { blurhash } : null),
        ...getDetailsColumns(details)
      }

      const ids = await trx('medias').insert(content, ['id'])
      if (ids.length === 0) return null

      const usageDelta = original.bytes + (thumbnail?.bytes ?? 0)
      if (actor?.accountId) {
        if (usageDelta > 0) {
          await increaseCounterValue(
            trx,
            CounterKey.mediaUsage(actor.accountId),
            usageDelta
          )
        }
        await increaseCounterValue(
          trx,
          CounterKey.totalMedia(actor.accountId),
          1
        )
      }
      await incrementBucket(trx, 'media-files', 1)
      if (usageDelta > 0) {
        await incrementBucket(trx, 'media-bytes', usageDelta)
      }

      return {
        // `Media.id` is a string everywhere else (`parseMediaRow` stringifies
        // it), and callers hand this straight to `createAttachment`. Returning
        // the driver's raw number wrote it into SQLite's `varchar`
        // `attachments.mediaId` as '1.0' via REAL->TEXT conversion, where
        // PostgreSQL's integer column stored a plain 1.
        id: String(ids[0].id),
        actorId,
        original,
        ...(thumbnail ? { thumbnail } : null),
        ...(description ? { description } : null),
        ...(focus ? { focus } : null),
        ...(blurhash ? { blurhash } : null),
        // Read back through the row parser so the lookup state the write
        // derived (a `pending` subject, the place name's source) is included.
        details: parseMediaDetails(content as unknown as MediaRow)
      } as Media
    })
  },
  async markMediaUploadVerified({
    mediaId,
    accountId,
    verifiedAt,
    dimensions,
    originalBytes,
    originalPath,
    clientPath,
    details
  }: MarkMediaUploadVerifiedParams): Promise<MarkMediaUploadVerifiedResult | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    // A read-check-write inside one transaction, with the row locked on
    // PostgreSQL (SQLite serialises transactions on its single connection), so
    // two completions of the same upload cannot both see `pending`: the second
    // waits, then reads the first one's `verified` row and changes nothing. The
    // usage delta is computed from the row read under that lock and applied
    // only by the call that made the transition.
    return database.transaction(async (trx) => {
      const query = trx('medias')
        .join('actors', 'medias.actorId', 'actors.id')
        .where('medias.id', id)
        .where('actors.accountId', accountId)
        .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
        .first<MediaRow>()
      if (isPostgresClient(database)) query.forUpdate('medias')
      const data = await query
      if (!data) return null

      const media = parseMediaRow(data)
      if (media.original.metaData.upload?.state !== 'pending') {
        return { media, transitioned: false }
      }

      const metaData = {
        ...media.original.metaData,
        ...(dimensions
          ? { width: dimensions.width, height: dimensions.height }
          : {}),
        upload: {
          ...media.original.metaData.upload,
          state: 'verified' as const,
          verifiedAt,
          ...(clientPath === undefined ? null : { clientPath })
        }
      }

      const bytesDelta =
        originalBytes === undefined ? 0 : originalBytes - media.original.bytes
      // The update is itself conditional on `pending` and the side effects
      // below run only when it changed the row, so the counter moves once
      // even if the lock above were ever bypassed.
      const changed = await trx('medias')
        .where('id', id)
        .whereRaw(
          isPostgresClient(database)
            ? `??->'upload'->>'state' = ?`
            : `json_extract(??, '$.upload.state') = ?`,
          ['originalMetaData', 'pending']
        )
        .update({
          originalMetaData: JSON.stringify(metaData),
          ...(originalBytes === undefined ? null : { originalBytes }),
          ...(originalPath === undefined ? null : { original: originalPath }),
          ...getDetailsColumns(details, media.details)
        })
      if (changed === 0) {
        const current = await trx('medias')
          .where('id', id)
          .select(MEDIA_COLUMNS)
          .first<MediaRow>()
        return current
          ? { media: parseMediaRow(current), transitioned: false }
          : null
      }
      // Keep the per-account usage counter in step with the rewritten object.
      if (bytesDelta > 0) {
        await increaseCounterValue(
          trx,
          CounterKey.mediaUsage(accountId),
          bytesDelta
        )
      } else if (bytesDelta < 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(accountId),
          -bytesDelta
        )
      }

      // Details go through column coercion (dates, JSON), so read them back
      // rather than echoing the input.
      const writtenDetails =
        details && Object.keys(getDetailsColumns(details)).length > 0
          ? parseMediaDetails(
              await trx('medias')
                .where('id', id)
                .select(MEDIA_COLUMNS)
                .first<MediaRow>()
            )
          : media.details

      return {
        media: {
          ...media,
          details: writtenDetails,
          original: {
            ...media.original,
            ...(originalBytes === undefined ? null : { bytes: originalBytes }),
            ...(originalPath === undefined ? null : { path: originalPath }),
            metaData
          }
        },
        transitioned: true
      }
    })
  },
  // NOTE: `mediaId` is WRITTEN here, not compared, so it does not go through
  // `toMediaRowId` — coercing would silently drop the link rather than surface
  // the caller's bad id. Almost every caller hands over an id read back out of
  // `medias`, but `POST /api/v1/accounts/outbox` does not: its
  // `PostBoxAttachment.id` is a bare `z.string()`. That endpoint now shape-
  // checks the id against `toMediaRowId` before it writes anything, so a
  // malformed one is a 422 rather than an `invalid input syntax for type
  // integer` raised here AFTER `createNote` had committed the status row.
  // The guard belongs at the route, not here: it is the last point at which
  // the request can be refused before a write, and `createNote.ts` opens no
  // transaction to roll one back.
  async createAttachment({
    actorId,
    statusId,
    mediaType,
    url,
    width,
    height,
    name = '',
    mediaId,
    createdAt,
    blurhash,
    focus,
    thumbnailUrl,
    playbackType
  }: CreateAttachmentParams): Promise<Attachment> {
    const currentTime =
      typeof createdAt === 'number' ? new Date(createdAt) : new Date()
    const data = Attachment.parse({
      id: crypto.randomUUID(),
      actorId,
      statusId,
      type: 'Document',
      mediaType,
      url,
      width,
      height,
      name,
      blurhash: blurhash ?? undefined,
      focus: focus ?? undefined,
      thumbnailUrl: thumbnailUrl ?? undefined,
      playbackType: playbackType ?? undefined,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    })
    await database('attachments').insert({
      id: data.id,
      actorId: data.actorId,
      statusId: data.statusId,
      type: data.type,
      mediaType: data.mediaType,
      url: data.url,
      width: data.width,
      height: data.height,
      name: data.name,
      mediaId: toCanonicalMediaId(mediaId),
      blurhash: blurhash ?? null,
      focusX: focus?.x ?? null,
      focusY: focus?.y ?? null,
      thumbnailUrl: thumbnailUrl ?? null,
      playbackType: playbackType ?? null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return data
  },

  async updateAttachmentPlayback({
    id,
    statusId,
    playbackType,
    thumbnailUrl,
    onlyIfUnset
  }: UpdateAttachmentPlaybackParams): Promise<boolean> {
    const updates: Record<string, unknown> = {
      playbackType,
      updatedAt: new Date()
    }
    if (thumbnailUrl !== undefined) {
      updates.thumbnailUrl = thumbnailUrl
    }
    const query = database('attachments')
      .where('id', id)
      .andWhere('statusId', statusId)
    if (onlyIfUnset) {
      query.whereNull('playbackType')
    }
    const updated = await query.update(updates)
    return updated > 0
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await database('attachments')
      .where('statusId', statusId)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
    return data
      .map((item) => {
        if (!item.actorId) return null
        return Attachment.parse({
          ...item,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          mediaId:
            item.mediaId === null || item.mediaId === undefined
              ? null
              : String(item.mediaId),
          blurhash: item.blurhash ?? undefined,
          focus:
            item.focusX !== null &&
            item.focusX !== undefined &&
            item.focusY !== null &&
            item.focusY !== undefined
              ? { x: Number(item.focusX), y: Number(item.focusY) }
              : undefined,
          thumbnailUrl: item.thumbnailUrl ?? undefined,
          playbackType: item.playbackType ?? undefined,
          createdAt: getCompatibleTime(item.createdAt),
          updatedAt: getCompatibleTime(item.updatedAt)
        })
      })
      .filter((item): item is Attachment => Boolean(item))
  },

  async getAttachmentsWithMedia({
    statusId
  }: GetAttachmentsWithMediaParams): Promise<AttachmentWithMedia[]> {
    const data = await database('attachments')
      .where('statusId', statusId)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .select(
        'id',
        'actorId',
        'statusId',
        'type',
        'mediaType',
        'url',
        'width',
        'height',
        'name',
        'createdAt',
        'updatedAt',
        'mediaId',
        'blurhash',
        'focusX',
        'focusY',
        'thumbnailUrl',
        'playbackType'
      )

    return data
      .map((item) => {
        if (!item.actorId) return null

        const attachment = Attachment.parse({
          ...item,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          mediaId:
            item.mediaId === null || item.mediaId === undefined
              ? null
              : String(item.mediaId),
          blurhash: item.blurhash ?? undefined,
          focus:
            item.focusX !== null &&
            item.focusX !== undefined &&
            item.focusY !== null &&
            item.focusY !== undefined
              ? { x: Number(item.focusX), y: Number(item.focusY) }
              : undefined,
          thumbnailUrl: item.thumbnailUrl ?? undefined,
          playbackType: item.playbackType ?? undefined,
          createdAt: getCompatibleTime(item.createdAt),
          updatedAt: getCompatibleTime(item.updatedAt)
        })

        return {
          ...attachment,
          mediaId:
            item.mediaId === null || item.mediaId === undefined
              ? null
              : String(item.mediaId)
        } satisfies AttachmentWithMedia
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  },

  async getAttachmentsForActor({
    actorId,
    limit = 25,
    maxCreatedAt,
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    let query = database('attachments')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')

    // An attachment inherits its status's audience. Filtering on `statusId`
    // against the same subquery `getActorStatuses` uses is what keeps a
    // followers-only post's images out of a stranger's media gallery; a null
    // subquery is the deliberate unfiltered mode (the owner's own gallery).
    const visibleStatusIds = buildActorVisibleStatusIdsQuery({
      database,
      actorId,
      publicOnly,
      visibleToActorId,
      includeFollowersOnly,
      followersAudience
    })
    if (visibleStatusIds) {
      query = query.whereIn('attachments.statusId', visibleStatusIds)
    }

    if (maxCreatedAt) {
      query = query.where('createdAt', '<', new Date(maxCreatedAt))
    }

    query = query.limit(limit)

    const data = await query
    return data
      .map((item) => {
        if (!item.actorId) return null
        return Attachment.parse({
          ...item,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          mediaId:
            item.mediaId === null || item.mediaId === undefined
              ? null
              : String(item.mediaId),
          blurhash: item.blurhash ?? undefined,
          focus:
            item.focusX !== null &&
            item.focusX !== undefined &&
            item.focusY !== null &&
            item.focusY !== undefined
              ? { x: Number(item.focusX), y: Number(item.focusY) }
              : undefined,
          thumbnailUrl: item.thumbnailUrl ?? undefined,
          playbackType: item.playbackType ?? undefined,
          createdAt: getCompatibleTime(item.createdAt),
          updatedAt: getCompatibleTime(item.updatedAt)
        })
      })
      .filter((item): item is Attachment => Boolean(item))
  },

  async getMediasWithStatusForAccount({
    accountId,
    limit = 100,
    page = 1,
    maxCreatedAt
  }: GetMediasForAccountParams): Promise<PaginatedMediaWithStatus> {
    // Get total count from counter table for performance
    const totalPromise = getCounterValue(
      database,
      CounterKey.totalMedia(accountId)
    )

    // Then get the paginated items
    let itemsQuery = database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
      .orderBy('medias.createdAt', 'desc')
      .orderBy('medias.id', 'desc')

    if (maxCreatedAt) {
      itemsQuery = itemsQuery.where(
        'medias.createdAt',
        '<',
        new Date(maxCreatedAt)
      )
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit
    itemsQuery = itemsQuery.limit(limit).offset(offset)

    const [total, data] = await Promise.all([
      totalPromise,
      itemsQuery as Promise<MediaRow[]>
    ])

    if (data.length === 0) {
      return { items: [], total }
    }

    const numericIds = data
      .map((item) => toMediaRowId(String(item.id)))
      .filter((id): id is number => id !== null)

    const statusIdByMediaId = new Map<string, string>()

    if (numericIds.length > 0) {
      const batchSize = getWhereInBatchSize(database, 2)
      for (const chunk of chunkArray(numericIds, batchSize)) {
        const attachmentRows = await database('attachments')
          .join('medias', 'medias.id', 'attachments.mediaId')
          .join('actors', 'attachments.actorId', 'actors.id')
          .where('actors.accountId', accountId)
          .whereIn('medias.id', chunk)
          .whereNotNull('attachments.statusId')
          .where('attachments.statusId', '<>', '')
          .groupBy('medias.id')
          .select('medias.id as mediaId')
          .min({ statusId: 'attachments.statusId' })

        for (const row of attachmentRows as {
          mediaId: string | number
          statusId: string | null
        }[]) {
          if (row.statusId) {
            statusIdByMediaId.set(String(row.mediaId), row.statusId)
          }
        }
      }
    }

    const items = data.map((item) => {
      const media = parseMediaRow(item)
      const statusId = statusIdByMediaId.get(media.id)
      return {
        ...media,
        ...(statusId ? { statusId } : {})
      }
    })

    return { items, total }
  },

  async getMediaByIdForAccount({
    mediaId,
    accountId
  }: GetMediaByIdParams): Promise<Media | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    const data = await database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('medias.id', id)
      .where('actors.accountId', accountId)
      .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
      .first()

    if (!data) return null

    return parseMediaRow(data)
  },

  async getMediaByIdsForAccount({
    mediaIds,
    accountId
  }: GetMediaByIdsForAccountParams): Promise<Media[]> {
    // Drop empty/invalid ids rather than letting them reach the IN query; see
    // toMediaRowId.
    const numericIds = mediaIds
      .map(toMediaRowId)
      .filter((id): id is number => id !== null)
    if (numericIds.length === 0) return []
    const rows = await database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .whereIn('medias.id', numericIds)
      .where('actors.accountId', accountId)
      .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
    return rows.map(parseMediaRow)
  },

  async updateMedia({
    mediaId,
    accountId,
    actorId,
    description,
    focus,
    blurhash,
    thumbnail,
    details
  }: UpdateMediaParams): Promise<UpdateMediaResult | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    return database.transaction(async (trx) => {
      // The whole row, locked on PostgreSQL: the lookup resets below are
      // decided against what is stored, so a concurrent lookup write cannot
      // slip in between this read and the update.
      const ownedQuery = trx('medias')
        .join('actors', 'medias.actorId', 'actors.id')
        .where('medias.id', id)
        .where('actors.accountId', accountId)
        .modify((query) => {
          if (actorId) query.where('medias.actorId', actorId)
        })
        .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
        .first<MediaRow>()
      if (isPostgresClient(database) && details) ownedQuery.forUpdate('medias')
      const owned = await ownedQuery
      if (!owned) return null

      // Only touch fields the caller actually provided so a partial update can't
      // blank out existing metadata (e.g. a description-only update must not
      // clear focus, and a focus-only update must not clear the description).
      const updates: {
        updatedAt: Date
        description?: string | null
        focusX?: number
        focusY?: number
        blurhash?: string | null
        thumbnail?: string
        thumbnailBytes?: number
        thumbnailMimeType?: string
        thumbnailMetaData?: string
      } & Record<string, unknown> = { updatedAt: new Date() }

      if (description !== undefined) {
        updates.description = description
      }
      if (focus !== undefined) {
        updates.focusX = focus.x
        updates.focusY = focus.y
      }
      if (blurhash !== undefined) {
        updates.blurhash = blurhash
      }

      Object.assign(
        updates,
        getDetailsColumns(details, parseMediaDetails(owned))
      )

      let thumbnailUsageDelta = 0
      let replacedThumbnailPath: string | null = null
      if (thumbnail !== undefined) {
        // The path being overwritten, read inside the transaction — the caller
        // deletes exactly this file, immune to a concurrent thumbnail update.
        if (owned.thumbnail && owned.thumbnail !== thumbnail.path) {
          replacedThumbnailPath = owned.thumbnail
        }
        updates.thumbnail = thumbnail.path
        updates.thumbnailBytes = thumbnail.bytes
        updates.thumbnailMimeType = thumbnail.mimeType
        updates.thumbnailMetaData = JSON.stringify(thumbnail.metaData)
        thumbnailUsageDelta =
          thumbnail.bytes -
          parseCounterValue(owned.thumbnailBytes as number | string | null)
      }

      await trx('medias').where('id', id).update(updates)

      // Replacing a thumbnail changes stored bytes; keep the per-account usage
      // counter (read by getStorageUsageForAccount / quota checks) in sync.
      if (thumbnailUsageDelta > 0) {
        await increaseCounterValue(
          trx,
          CounterKey.mediaUsage(accountId),
          thumbnailUsageDelta
        )
      } else if (thumbnailUsageDelta < 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(accountId),
          -thumbnailUsageDelta
        )
      }

      const data = await trx('medias')
        .where('id', id)
        .select([...MEDIA_COLUMNS])
        .first()

      if (!data) return null

      return { media: parseMediaRow(data), replacedThumbnailPath }
    })
  },

  async getMediaWithAttachedStatusIds({
    mediaId
  }: GetMediaWithAttachedStatusIdsParams): Promise<MediaWithAttachedStatusIds | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    const data = await database('medias')
      .where('medias.id', id)
      .select(MEDIA_COLUMNS.map((column) => `medias.${column}`))
      .first<MediaRow>()
    if (!data) return null

    // `attachments.mediaId` is `varchar` on SQLite and `integer` on PostgreSQL;
    // joining on `medias.id` lets each backend compare it its own way, as
    // `getMediasWithStatusForAccount` does.
    //
    // Only an attachment written by the media's OWNER counts as evidence the
    // owner published it. `attachments.mediaId` is a bare pointer, and any
    // actor can write one (the outbox takes attachment objects from the
    // client), so without this an attacker's public post pointing at someone
    // else's media id would unlock that media's private details. Ownership is
    // account-wide, matching the upload and attach routes: a second persona on
    // the owner's account attaching the media still counts.
    const rows = await database('attachments')
      .join('medias', 'medias.id', 'attachments.mediaId')
      .join(
        'actors as attachmentActors',
        'attachmentActors.id',
        'attachments.actorId'
      )
      .join('actors as mediaActors', 'mediaActors.id', 'medias.actorId')
      .where('medias.id', id)
      .where((builder) =>
        builder
          .where('attachments.actorId', database.ref('medias.actorId'))
          .orWhere((sameAccount) =>
            sameAccount
              .whereNotNull('mediaActors.accountId')
              .where(
                'attachmentActors.accountId',
                database.ref('mediaActors.accountId')
              )
          )
      )
      .whereNotNull('attachments.statusId')
      .where('attachments.statusId', '<>', '')
      .distinct('attachments.statusId')
      .select<{ statusId: string }[]>('attachments.statusId')

    return {
      media: parseMediaRow(data),
      statusIds: rows.map((row) => row.statusId)
    }
  },

  async getStorageUsageForAccount({
    accountId
  }: GetStorageUsageForAccountParams): Promise<number> {
    return getCounterValue(database, CounterKey.mediaUsage(accountId))
  },

  async deleteAttachmentsByIds({
    attachmentIds
  }: DeleteAttachmentsByIdsParams): Promise<number> {
    if (attachmentIds.length === 0) {
      return 0
    }

    return database('attachments').whereIn('id', attachmentIds).delete()
  },

  async deleteMedia({ mediaId }: DeleteMediaParams): Promise<boolean> {
    return deleteMediaById(database, mediaId)
  },

  async deleteMediaForAccount({
    mediaId,
    accountId
  }: DeleteMediaForAccountParams): Promise<DeleteMediaForAccountResult> {
    const mediaRowId = toMediaRowId(mediaId)
    if (mediaRowId === null) return { status: 'not-found' }

    return database.transaction(async (trx) => {
      // Owner scope: only the account that owns the media (via its actors) can
      // delete it. Mastodon scopes destroy to `current_account.media_attachments`.
      const media = await trx('medias')
        .join('actors', 'medias.actorId', 'actors.id')
        .where('medias.id', mediaRowId)
        .where('actors.accountId', accountId)
        .select(
          'medias.id',
          'medias.actorId',
          'medias.original',
          'medias.originalMetaData',
          'medias.thumbnail',
          'medias.originalBytes',
          'medias.thumbnailBytes'
        )
        .first<{
          id: string | number
          actorId: string
          original: string
          originalMetaData: string | MediaMetaData | null
          thumbnail: string | null
          originalBytes: number | string | bigint | null
          thumbnailBytes: number | string | bigint | null
        }>()
      if (!media) return { status: 'not-found' }

      // Mastodon's destroy returns 422 (in_usage_error) when the attachment is
      // already tied to a posted status, rather than deleting it. Match via a
      // medias↔attachments join (column-to-column) so the comparison is
      // affinity-safe on SQLite (where attachments.mediaId is TEXT but medias.id
      // is INTEGER) and works on PostgreSQL too — the same join
      // getMediasWithStatusForAccount uses.
      const attached = await trx('attachments')
        .join('medias', 'medias.id', 'attachments.mediaId')
        .where('medias.id', media.id)
        .first('attachments.id')
      if (attached) return { status: 'in-use' }

      // The owner's album lock first, then the album rows, then the media row.
      await lockGalleryAlbumActor(trx, media.actorId)
      await removeMediaFromGalleryAlbums(trx, Number(media.id))
      const deleted = await trx('medias').where('id', media.id).del()
      if (!deleted) return { status: 'not-found' }

      const usageDelta =
        parseCounterValue(media.originalBytes) +
        parseCounterValue(media.thumbnailBytes)
      if (usageDelta > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(accountId),
          usageDelta
        )
      }
      await decreaseCounterValue(trx, CounterKey.totalMedia(accountId), 1)

      // Return the paths captured inside the transaction so the caller deletes
      // exactly the files that belonged to this row (no racy prefetch).
      // The presigned URL outlives the key swap, so a re-PUT may have
      // recreated an object at the client's original key: delete it as well.
      const clientPath = parseMediaMetaData(media.originalMetaData).upload
        ?.clientPath
      const files = [
        media.original,
        ...(clientPath && clientPath !== media.original ? [clientPath] : []),
        ...(media.thumbnail ? [media.thumbnail] : [])
      ]
      return { status: 'deleted', files }
    })
  },

  async setMediaSubjectLookup({
    mediaId,
    expect,
    patch
  }: SetMediaSubjectLookupParams): Promise<boolean> {
    const id = toMediaRowId(mediaId)
    if (id === null) return false

    const { subjectLookupStatus } = patch
    if (
      subjectLookupStatus !== null &&
      parseLookupStatus(subjectLookupStatus) === null
    ) {
      throw new Error(`Unknown subject lookup status: ${subjectLookupStatus}`)
    }
    if (
      patch.subjectIucnCategory !== undefined &&
      patch.subjectIucnCategory !== null &&
      parseIucnCategory(patch.subjectIucnCategory) === null
    ) {
      throw new Error(`Unknown IUCN category: ${patch.subjectIucnCategory}`)
    }

    const updates: Record<string, unknown> = {
      subjectLookupStatus,
      subjectLookupAt: new Date(patch.subjectLookupAt ?? Date.now())
    }
    if (patch.subjectIucnCategory !== undefined) {
      updates.subjectIucnCategory = patch.subjectIucnCategory
    }
    if (patch.subjectTaxonKey !== undefined) {
      updates.subjectTaxonKey = patch.subjectTaxonKey?.trim() || null
    }
    if (patch.subjectTaxonPath !== undefined) {
      const path = toTaxonPath(patch.subjectTaxonPath)
      updates.subjectTaxonPath = path ? JSON.stringify(path) : null
    }

    const query = database('medias').where('id', id)
    whereNullSafe(query, 'subjectName', expect.subjectName)
    whereNullSafe(query, 'subjectScientificName', expect.subjectScientificName)
    whereNullSafe(query, 'subjectTaxonKey', expect.subjectTaxonKey)
    if (expect.subjectCategory !== undefined) {
      whereNullSafe(query, 'subjectCategory', expect.subjectCategory)
    }
    const changed = await query.update(updates)
    return changed > 0
  },

  async setMediaPlaceLookup({
    mediaId,
    expect,
    patch
  }: SetMediaPlaceLookupParams): Promise<boolean> {
    const id = toMediaRowId(mediaId)
    if (id === null) return false

    const { placeLookupStatus } = patch
    if (
      placeLookupStatus !== null &&
      parseLookupStatus(placeLookupStatus) === null
    ) {
      throw new Error(`Unknown place lookup status: ${placeLookupStatus}`)
    }

    const updates: Record<string, unknown> = {
      placeLookupStatus,
      placeLookupAt: new Date(patch.placeLookupAt ?? Date.now())
    }
    if (patch.placeCountryCode !== undefined) {
      const code = patch.placeCountryCode?.trim().toUpperCase() || null
      updates.placeCountryCode = parseCountryCode(code)
    }

    const matchesPoint = (query: Knex.QueryBuilder) => {
      query.where('id', id)
      whereNullSafe(query, 'placeLatitude', expect.placeLatitude)
      whereNullSafe(query, 'placeLongitude', expect.placeLongitude)
      return query
    }

    return database.transaction(async (trx) => {
      const changed = await matchesPoint(trx('medias')).update(updates)
      if (changed === 0) return false

      if (patch.placeName !== undefined) {
        const placeName = patch.placeName?.trim().slice(0, 255) || null
        // Never replaces the owner's own name: only a missing name, or one the
        // geocoder wrote itself (a legacy null source counts as the owner's).
        await matchesPoint(trx('medias'))
          .where((builder) =>
            builder
              .whereNull('placeName')
              .orWhere('placeNameSource', 'geocoder')
          )
          .update({
            placeName,
            placeNameSource: placeName === null ? null : 'geocoder'
          })
      }
      return true
    })
  },

  async setMediaSubjectSuggestions({
    mediaId,
    suggestions
  }: SetMediaSubjectSuggestionsParams): Promise<boolean> {
    const id = toMediaRowId(mediaId)
    if (id === null) return false

    const value = suggestions === null ? null : JSON.stringify(suggestions)
    if (
      value !== null &&
      Buffer.byteLength(value, 'utf8') > MAX_SUBJECT_SUGGESTIONS_BYTES
    ) {
      return false
    }
    const changed = await database('medias')
      .where('id', id)
      .update({ subjectSuggestions: value })
    return changed > 0
  }
})
