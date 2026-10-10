import { Knex } from 'knex'

import type { mediaQueries } from '@/lib/database/domains/media/queries'
import {
  MEDIA_COLUMNS,
  type MediaMetaData,
  type MediaRow,
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parseMediaDetails,
  parseMediaMetaData,
  parseMediaRow,
  toCanonicalMediaId,
  toMediaRowId,
  toTaxonPath
} from '@/lib/database/domains/media/rows'
import {
  lockGalleryAlbumActor,
  removeMediaFromGalleryAlbums
} from '@/lib/database/sql/galleryAlbumCleanup'
import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { isSpeciesLike } from '@/lib/services/gallery/threatenedSpecies'
import {
  EMPTY_MEDIA_DETAILS,
  MAX_SUBJECT_SUGGESTIONS_BYTES,
  MediaDetailsRecord
} from '@/lib/types/database/gallery'
import {
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteAttachmentsByIdsParams,
  DeleteMediaForAccountParams,
  DeleteMediaForAccountResult,
  DeleteMediaParams,
  DeleteMediaWithFilesResult,
  MarkMediaUploadVerifiedParams,
  MarkMediaUploadVerifiedResult,
  Media,
  MediaDatabase,
  ReplaceRemoteAttachmentsForStatusParams,
  SetMediaPlaceLookupParams,
  SetMediaSubjectLookupParams,
  SetMediaSubjectSuggestionsParams,
  UpdateAttachmentPlaybackParams,
  UpdateMediaDetailsParams,
  UpdateMediaParams,
  UpdateMediaResult
} from '@/lib/types/database/operations'
import { Attachment, isFitnessAttachment } from '@/lib/types/domain/attachment'

import { isPostgresClient } from './utils/knex'

// The row helpers moved to lib/database/domains/media/rows.ts with the media
// reads; these re-exports keep the gallery mixins, the gallery services and
// the outbox route importing them from here unchanged.
export {
  MAX_MEDIA_ROW_ID,
  MAX_TAXON_NAME_LENGTH,
  MAX_TAXON_PATH_LENGTH,
  MEDIA_COLUMNS,
  type MediaRow,
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parseMediaRow,
  parsePlaceNameSource,
  parseSubjectSuggestions,
  parseTaxonPath,
  toMediaRowId
} from '@/lib/database/domains/media/rows'

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
const insertAttachment = async (
  database: Knex | Knex.Transaction,
  {
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
  }: CreateAttachmentParams
): Promise<Attachment> => {
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
}

type MediaDeleteRow = {
  id: string | number
  actorId: string
  original: string
  originalMetaData: string | MediaMetaData | null
  thumbnail: string | null
  originalBytes: number | string | bigint | null
  thumbnailBytes: number | string | bigint | null
}

// The media row a delete removes, re-read under its row lock (FOR UPDATE on
// PostgreSQL; SQLite serialises write transactions on its one connection).
// A photo edit locks the same row before it moves `original` and adds
// `media_edit_files` rows, so once this returns no save can commit a file the
// delete would miss: what it reads here is everything the row stores.
const lockMediaForDelete = async (
  trx: Knex.Transaction,
  mediaId: string | number
): Promise<MediaDeleteRow | undefined> => {
  const query = trx('medias')
    .where('id', mediaId)
    .select(
      'id',
      'actorId',
      'original',
      'originalMetaData',
      'thumbnail',
      'originalBytes',
      'thumbnailBytes'
    )
  if (isPostgresClient(trx)) query.forUpdate()
  return query.first<MediaDeleteRow | undefined>()
}

// Every stored path a deleted media row kept: the live file, the presigned
// upload's own key when the stripped copy replaced it (a re-PUT through the
// still-valid URL can recreate it), the thumbnail and the photo edit files.
const getDeletedMediaFiles = (
  media: MediaDeleteRow,
  editFilePaths: string[]
): string[] => {
  const clientPath = parseMediaMetaData(media.originalMetaData).upload
    ?.clientPath
  return [
    ...new Set([
      media.original,
      ...(clientPath && clientPath !== media.original ? [clientPath] : []),
      ...(media.thumbnail ? [media.thumbnail] : []),
      ...editFilePaths
    ])
  ]
}

// Deletes the row inside the caller's transaction once its owner's album lock
// and its own row lock are held, frees everything it stored from the account's
// usage, and returns the paths to delete after the commit.
const deleteLockedMedia = async (
  trx: Knex.Transaction,
  media: MediaDeleteRow,
  accountId: string | null | undefined
): Promise<string[] | null> => {
  await removeMediaFromGalleryAlbums(trx, Number(media.id))
  const editFilePaths = await getMediaEditFilePathsForMedia(trx, media.id)
  const editFileBytes = await deleteMediaEditFiles(trx, media.id)
  const deleted = await trx('medias').where('id', media.id).del()
  if (!deleted) return null

  const usageDelta =
    parseCounterValue(media.originalBytes) +
    parseCounterValue(media.thumbnailBytes) +
    editFileBytes
  if (accountId) {
    if (usageDelta > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.mediaUsage(accountId),
        usageDelta
      )
    }
    await decreaseCounterValue(trx, CounterKey.totalMedia(accountId), 1)
  }
  return getDeletedMediaFiles(media, editFilePaths)
}

const deleteMediaByConditions = async (
  database: Knex,
  conditions: Record<string, string | number>
): Promise<DeleteMediaWithFilesResult> => {
  return database.transaction(async (trx) => {
    const found = await trx('medias')
      .where(conditions)
      .select('id', 'actorId')
      .first<{ id: string | number; actorId: string } | undefined>()
    if (!found) return { status: 'not-found' }

    const actor = await trx('actors')
      .where('id', found.actorId)
      .select<{ accountId: string | null }>('accountId')
      .first()

    // The owner's album lock first (the order every album write takes), then
    // the media row, then the album rows.
    await lockGalleryAlbumActor(trx, found.actorId)
    const media = await lockMediaForDelete(trx, found.id)
    if (!media) return { status: 'not-found' }
    const files = await deleteLockedMedia(trx, media, actor?.accountId)
    return files ? { status: 'deleted', files } : { status: 'not-found' }
  })
}

// Removes the photo edit files a media row keeps (its uploaded original,
// superseded renders and masks) and returns their total bytes, so the usage
// counter drops by everything the row stored. The foreign key cascades these
// on PostgreSQL, but SQLite may run without foreign keys.
const deleteMediaEditFiles = async (
  trx: Knex.Transaction,
  mediaId: string | number
): Promise<number> => {
  const rows = await trx('media_edit_files')
    .where('mediaId', mediaId)
    .select<{ bytes: number | string | bigint | null }[]>('bytes')
  if (rows.length === 0) return 0
  await trx('media_edit_files').where('mediaId', mediaId).del()
  return rows.reduce((sum, row) => sum + parseCounterValue(row.bytes), 0)
}

// The stored paths of a media's edit files: each file, and the original
// slot's presigned `upload.clientPath` when it differs from its path.
const getMediaEditFilePathsForMedia = async (
  trx: Knex.Transaction,
  mediaId: string | number
): Promise<string[]> => {
  const rows = await trx('media_edit_files')
    .where('mediaId', mediaId)
    .select<{ slot: string; path: string; metaData: string | null }[]>(
      'slot',
      'path',
      'metaData'
    )
  const paths = new Set<string>()
  for (const row of rows) {
    paths.add(row.path)
    if (row.slot !== 'original') continue
    const clientPath = parseMediaMetaData(row.metaData).upload?.clientPath
    if (clientPath && clientPath !== row.path) paths.add(clientPath)
  }
  return [...paths]
}

const deleteMediaById = async (
  database: Knex,
  mediaId: string
): Promise<DeleteMediaWithFilesResult> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return { status: 'not-found' }
  return deleteMediaByConditions(database, { id })
}

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

// The media writes, still on Knex. The reads are Kysely queries in
// lib/database/domains/media/queries.ts; getSQLDatabase binds them with bindDb
// and spreads both into the facade.
export type MediaWriteDatabase = Omit<MediaDatabase, keyof typeof mediaQueries>

export const MediaSQLDatabaseMixin = (database: Knex): MediaWriteDatabase => ({
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
  async createAttachment(params: CreateAttachmentParams): Promise<Attachment> {
    return insertAttachment(database, params)
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

  // Swaps the attachments a remote note brought along (no media row of their
  // own) for the list an inbound Update carries, in one transaction, so a
  // failure part-way leaves the old rows and no reader sees none in between.
  // A local media attachment and a fitness file are never touched.
  async replaceRemoteAttachmentsForStatus({
    statusId,
    attachments
  }: ReplaceRemoteAttachmentsForStatusParams): Promise<void> {
    await database.transaction(async (trx) => {
      const rows = await trx('attachments')
        .where('statusId', statusId)
        .whereNull('mediaId')
        .select('id', 'mediaType', 'url', 'name')
      const ids = rows
        .filter(
          (row) =>
            !isFitnessAttachment({
              mediaType: String(row.mediaType ?? ''),
              url: String(row.url ?? ''),
              name: String(row.name ?? '')
            })
        )
        .map((row) => row.id)
      if (ids.length > 0) {
        await trx('attachments')
          .where('statusId', statusId)
          .whereNull('mediaId')
          .whereIn('id', ids)
          .delete()
      }
      for (const attachment of attachments) {
        await insertAttachment(trx, { ...attachment, statusId })
      }
    })
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

  async deleteAttachmentsByIds({
    attachmentIds
  }: DeleteAttachmentsByIdsParams): Promise<number> {
    if (attachmentIds.length === 0) {
      return 0
    }

    return database('attachments').whereIn('id', attachmentIds).delete()
  },

  async deleteMedia({ mediaId }: DeleteMediaParams): Promise<boolean> {
    return (await deleteMediaById(database, mediaId)).status === 'deleted'
  },

  async deleteMediaWithFiles({
    mediaId
  }: DeleteMediaParams): Promise<DeleteMediaWithFilesResult> {
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
        .select('medias.id', 'medias.actorId')
        .first<{ id: string | number; actorId: string } | undefined>()
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

      // The owner's album lock first, then the media row, then the album rows.
      await lockGalleryAlbumActor(trx, media.actorId)
      const locked = await lockMediaForDelete(trx, media.id)
      if (!locked) return { status: 'not-found' }
      const files = await deleteLockedMedia(trx, locked, accountId)
      // The paths are captured inside the transaction so the caller deletes
      // exactly the files that belonged to this row (no racy prefetch).
      return files ? { status: 'deleted', files } : { status: 'not-found' }
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
