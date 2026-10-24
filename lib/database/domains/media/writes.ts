import type {
  ExpressionBuilder,
  Insertable,
  NotNull,
  UpdateQueryBuilder,
  UpdateResult,
  Updateable
} from 'kysely'

import {
  lockGalleryAlbumActor,
  removeMediaFromGalleryAlbums
} from '@/lib/database/domains/media/galleryAlbumCleanup'
import {
  MEDIA_COLUMNS,
  MEDIA_SELECT,
  type MediaMetaData,
  type MediaRow,
  asMediaRow,
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parseMediaDetails,
  parseMediaMetaData,
  parseMediaRow,
  toAttachmentMediaId,
  toMediaRowId,
  toTaxonPath
} from '@/lib/database/domains/media/rows'
import type {
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
  ReplaceRemoteAttachmentsForStatusParams,
  SetMediaPlaceLookupParams,
  SetMediaSubjectLookupParams,
  SetMediaSubjectSuggestionsParams,
  UpdateAttachmentPlaybackParams,
  UpdateMediaDetailsParams,
  UpdateMediaParams,
  UpdateMediaResult
} from '@/lib/database/domains/media/types'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import type { Attachments, Medias } from '@/lib/database/kysely/db'
import { forUpdate, jsonText } from '@/lib/database/kysely/dialect'
import { CounterKey, parseCounterValue } from '@/lib/database/utils/counter'
import { isSpeciesLike } from '@/lib/services/gallery/threatenedSpecies'
import {
  EMPTY_MEDIA_DETAILS,
  MAX_SUBJECT_SUGGESTIONS_BYTES,
  MediaDetailsRecord
} from '@/lib/types/database/gallery'
import { Attachment, isFitnessAttachment } from '@/lib/types/domain/attachment'

// The media writes: create, upload verification, updates, the lookup
// compare-and-sets, deletes and the attachment writes. The reads are in
// ./queries.ts, whose `mediaQueries` holds both.

// NOTE: `mediaId` is WRITTEN here, not compared, so a bad id is an error
// (`toAttachmentMediaId`) rather than a miss — coercing it would silently drop
// the link rather than surface the caller's bad id. Almost every caller hands
// over an id read back out of `medias`, but `POST /api/v1/accounts/outbox` does
// not: its `PostBoxAttachment.id` is a bare `z.string()`. That endpoint
// shape-checks the id against `toMediaRowId` before it writes anything, so a
// malformed one is a 422 rather than an error raised here AFTER `createNote`
// had committed the status row. The guard belongs at the route, not here: it is
// the last point at which the request can be refused before a write, and
// `createNote.ts` opens no transaction to roll one back.
const insertAttachment = async (
  db: Db,
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
  await db
    .insertInto('attachments')
    .values({
      id: data.id,
      actorId: data.actorId,
      statusId: data.statusId,
      type: data.type,
      mediaType: data.mediaType,
      url: data.url,
      width: data.width,
      height: data.height,
      name: data.name,
      mediaId: toAttachmentMediaId(mediaId),
      blurhash: blurhash ?? null,
      focusX: focus?.x ?? null,
      focusY: focus?.y ?? null,
      thumbnailUrl: thumbnailUrl ?? null,
      playbackType: playbackType ?? null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  return data
}

type MediaDeleteRow = {
  id: number
  actorId: string
  original: string
  originalMetaData: MediaMetaData | null
  thumbnail: string | null
  originalBytes: number | null
  thumbnailBytes: number | null
}

// The media row a delete removes, re-read under its row lock (FOR UPDATE on
// PostgreSQL; SQLite serialises write transactions on its one connection).
// A photo edit locks the same row before it moves `original` and adds
// `media_edit_files` rows, so once this returns no save can commit a file the
// delete would miss: what it reads here is everything the row stores.
const lockMediaForDelete = async (
  trx: Db,
  mediaId: number
): Promise<MediaDeleteRow | undefined> =>
  (await forUpdate(
    trx,
    trx
      .selectFrom('medias')
      .select([
        'id',
        'actorId',
        'original',
        'originalMetaData',
        'thumbnail',
        'originalBytes',
        'thumbnailBytes'
      ])
      .where('id', '=', mediaId)
      .limit(1)
  ).executeTakeFirst()) as MediaDeleteRow | undefined

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

// Removes the photo edit files a media row keeps (its uploaded original,
// superseded renders and masks) and returns their total bytes, so the usage
// counter drops by everything the row stored. The foreign key cascades these
// on PostgreSQL, but SQLite may run without foreign keys.
const deleteMediaEditFiles = async (
  trx: Db,
  mediaId: number
): Promise<number> => {
  const rows = await trx
    .selectFrom('media_edit_files')
    .select('bytes')
    .where('mediaId', '=', mediaId)
    .execute()
  if (rows.length === 0) return 0
  await trx
    .deleteFrom('media_edit_files')
    .where('mediaId', '=', mediaId)
    .execute()
  return rows.reduce((sum, row) => sum + parseCounterValue(row.bytes), 0)
}

// The stored paths of a media's edit files: each file, and the original
// slot's presigned `upload.clientPath` when it differs from its path.
const getMediaEditFilePathsForMedia = async (
  trx: Db,
  mediaId: number
): Promise<string[]> => {
  const rows = await trx
    .selectFrom('media_edit_files')
    .select(['slot', 'path', 'metaData'])
    .where('mediaId', '=', mediaId)
    .execute()
  const paths = new Set<string>()
  for (const row of rows) {
    paths.add(row.path)
    if (row.slot !== 'original') continue
    const clientPath = parseMediaMetaData(row.metaData).upload?.clientPath
    if (clientPath && clientPath !== row.path) paths.add(clientPath)
  }
  return [...paths]
}

// Deletes the row inside the caller's transaction once its owner's album lock
// and its own row lock are held, frees everything it stored from the account's
// usage, and returns the paths to delete after the commit.
const deleteLockedMedia = async (
  trx: Db,
  media: MediaDeleteRow,
  accountId: string | null | undefined
): Promise<string[] | null> => {
  await removeMediaFromGalleryAlbums(trx, media.id)
  const editFilePaths = await getMediaEditFilePathsForMedia(trx, media.id)
  const editFileBytes = await deleteMediaEditFiles(trx, media.id)
  const { numDeletedRows } = await trx
    .deleteFrom('medias')
    .where('id', '=', media.id)
    .executeTakeFirst()
  if (Number(numDeletedRows) === 0) return null

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

// The unscoped delete behind `deleteMedia` and `deleteMediaWithFiles`.
const deleteMediaById = async (
  db: Db,
  mediaId: string
): Promise<DeleteMediaWithFilesResult> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return { status: 'not-found' }

  return inTransaction(db, async (trx): Promise<DeleteMediaWithFilesResult> => {
    const found = await trx
      .selectFrom('medias')
      .select(['id', 'actorId'])
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst()
    if (!found) return { status: 'not-found' }

    // A media row with no actor (a legacy row) binds NULL here, which
    // matches no actor: no account to charge and no album lock to take.
    const ownerId = found.actorId as string
    const actor = await trx
      .selectFrom('actors')
      .select('accountId')
      .where('id', '=', ownerId)
      .limit(1)
      .executeTakeFirst()

    // The owner's album lock first (the order every album write takes), then
    // the media row, then the album rows.
    await lockGalleryAlbumActor(trx, ownerId)
    const media = await lockMediaForDelete(trx, found.id)
    if (!media) return { status: 'not-found' }
    const files = await deleteLockedMedia(trx, media, actor?.accountId)
    return files ? { status: 'deleted', files } : { status: 'not-found' }
  })
}

// The `medias` columns a create or an update writes, as Kysely takes them.
type MediaColumns = Updateable<Medias>

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
): MediaColumns => {
  if (!details) return {}
  const columns: MediaColumns = {}
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
    const pick = <
      K extends
        | 'subjectName'
        | 'subjectScientificName'
        | 'subjectCategory'
        | 'subjectTaxonKey'
    >(
      key: K
    ) => (key in columns ? columns[key] : current[key]) as MediaDetailsRecord[K]
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

const resolveSortAtUpdate = (
  detailsColumns: MediaColumns,
  mediaCreatedAt: unknown
): Date | undefined => {
  if (!('takenAt' in detailsColumns)) return undefined
  if (detailsColumns.takenAt) {
    return new Date(detailsColumns.takenAt as Date | string | number)
  }
  if (mediaCreatedAt !== null && mediaCreatedAt !== undefined) {
    return new Date(mediaCreatedAt as Date | string | number)
  }
  return undefined
}

// The whole `medias` row by id, as the parser reads it.
const selectMediaRow = async (
  trx: Db,
  id: number
): Promise<MediaRow | undefined> => {
  const row = await trx
    .selectFrom('medias')
    .select(MEDIA_COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? asMediaRow(row) : undefined
}

// `column = value`, or `column IS NULL` for a null value: SQL's `= NULL` is
// never true, so a plain comparison would make every null expectation a miss.
const sameText =
  (
    column:
      | 'subjectName'
      | 'subjectScientificName'
      | 'subjectTaxonKey'
      | 'subjectCategory',
    value: string | null
  ) =>
  (eb: ExpressionBuilder<DB, 'medias'>) =>
    value === null ? eb(column, 'is', null) : eb(column, '=', value)

const sameNumber =
  (column: 'placeLatitude' | 'placeLongitude', value: number | null) =>
  (eb: ExpressionBuilder<DB, 'medias'>) =>
    value === null ? eb(column, 'is', null) : eb(column, '=', value)

export const createMedia = async (
  db: Db,
  {
    actorId,
    original,
    thumbnail,
    description,
    focus,
    blurhash,
    details
  }: CreateMediaParams
): Promise<Media | null> => {
  if (!actorId) return null

  return inTransaction(db, async (trx): Promise<Media | null> => {
    const actor = await trx
      .selectFrom('actors')
      .select('accountId')
      .where('id', '=', actorId)
      .limit(1)
      .executeTakeFirst()

    const detailsColumns = getDetailsColumns(details)
    const now = new Date()
    // sortAt may lead createdAt by under a second for a dateless upload
    const sortAt = detailsColumns.takenAt
      ? new Date(detailsColumns.takenAt as Date | string | number)
      : now

    const content: Insertable<Medias> = {
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
      ...detailsColumns,
      sortAt
    }

    const inserted = await trx
      .insertInto('medias')
      .values(content)
      .returning('id')
      .executeTakeFirst()
    if (!inserted) return null

    const usageDelta = original.bytes + (thumbnail?.bytes ?? 0)
    if (actor?.accountId) {
      if (usageDelta > 0) {
        await increaseCounterValue(
          trx,
          CounterKey.mediaUsage(actor.accountId),
          usageDelta
        )
      }
      await increaseCounterValue(trx, CounterKey.totalMedia(actor.accountId), 1)
    }
    await incrementBucket(trx, 'media-files', 1)
    if (usageDelta > 0) {
      await incrementBucket(trx, 'media-bytes', usageDelta)
    }

    return {
      // `Media.id` is a string everywhere else (`parseMediaRow` stringifies
      // it), and callers hand this straight to `createAttachment`.
      id: String(inserted.id),
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
}

export const markMediaUploadVerified = async (
  db: Db,
  {
    mediaId,
    accountId,
    verifiedAt,
    dimensions,
    originalBytes,
    originalPath,
    clientPath,
    details
  }: MarkMediaUploadVerifiedParams
): Promise<MarkMediaUploadVerifiedResult | null> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return null

  // A read-check-write inside one transaction, with the row locked on
  // PostgreSQL (SQLite serialises transactions on its single connection), so
  // two completions of the same upload cannot both see `pending`: the second
  // waits, then reads the first one's `verified` row and changes nothing. The
  // usage delta is computed from the row read under that lock and applied
  // only by the call that made the transition.
  return inTransaction(
    db,
    async (trx): Promise<MarkMediaUploadVerifiedResult | null> => {
      const data = await forUpdate(
        trx,
        trx
          .selectFrom('medias')
          .innerJoin('actors', 'medias.actorId', 'actors.id')
          .select(MEDIA_SELECT)
          .select('medias.createdAt as mediaCreatedAt')
          .where('medias.id', '=', id)
          .where('actors.accountId', '=', accountId)
          .limit(1),
        'medias'
      ).executeTakeFirst()
      if (!data) return null

      const media = parseMediaRow(asMediaRow(data))
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
      const detailsColumns = getDetailsColumns(details, media.details)
      const sortAt = resolveSortAtUpdate(detailsColumns, data.mediaCreatedAt)
      // The update is itself conditional on `pending` and the side effects
      // below run only when it changed the row, so the counter moves once
      // even if the lock above were ever bypassed.
      const { numUpdatedRows } = await trx
        .updateTable('medias')
        .set({
          originalMetaData: JSON.stringify(metaData),
          ...(originalBytes === undefined ? null : { originalBytes }),
          ...(originalPath === undefined ? null : { original: originalPath }),
          ...detailsColumns,
          ...(sortAt !== undefined ? { sortAt } : null)
        })
        .where('id', '=', id)
        .where(
          jsonText(trx, 'medias.originalMetaData', 'upload', 'state'),
          '=',
          'pending'
        )
        .executeTakeFirst()
      if (Number(numUpdatedRows) === 0) {
        const current = await selectMediaRow(trx, id)
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
        details && Object.keys(detailsColumns).length > 0
          ? parseMediaDetails((await selectMediaRow(trx, id)) as MediaRow)
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
    }
  )
}

export const createAttachment = (
  db: Db,
  params: CreateAttachmentParams
): Promise<Attachment> => insertAttachment(db, params)

export const updateAttachmentPlayback = async (
  db: Db,
  {
    id,
    statusId,
    playbackType,
    thumbnailUrl,
    onlyIfUnset
  }: UpdateAttachmentPlaybackParams
): Promise<boolean> => {
  const updates: Updateable<Attachments> = {
    playbackType,
    updatedAt: new Date()
  }
  if (thumbnailUrl !== undefined) {
    updates.thumbnailUrl = thumbnailUrl
  }
  const { numUpdatedRows } = await db
    .updateTable('attachments')
    .set(updates)
    .where('id', '=', id)
    .where('statusId', '=', statusId)
    .$if(Boolean(onlyIfUnset), (qb) => qb.where('playbackType', 'is', null))
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

// Swaps the attachments a remote note brought along (no media row of their
// own) for the list an inbound Update carries, in one transaction, so a
// failure part-way leaves the old rows and no reader sees none in between.
// A local media attachment and a fitness file are never touched.
export const replaceRemoteAttachmentsForStatus = async (
  db: Db,
  { statusId, attachments }: ReplaceRemoteAttachmentsForStatusParams
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    const rows = await trx
      .selectFrom('attachments')
      .select(['id', 'mediaType', 'url', 'name'])
      .where('statusId', '=', statusId)
      .where('mediaId', 'is', null)
      .execute()
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
      await trx
        .deleteFrom('attachments')
        .where('statusId', '=', statusId)
        .where('mediaId', 'is', null)
        .where('id', 'in', ids)
        .execute()
    }
    for (const attachment of attachments) {
      await insertAttachment(trx, { ...attachment, statusId })
    }
  })
}

export const updateMedia = async (
  db: Db,
  {
    mediaId,
    accountId,
    actorId,
    description,
    focus,
    blurhash,
    thumbnail,
    details
  }: UpdateMediaParams
): Promise<UpdateMediaResult | null> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return null

  return inTransaction(db, async (trx): Promise<UpdateMediaResult | null> => {
    // The whole row, locked on PostgreSQL when details are written: the
    // lookup resets below are decided against what is stored, so a
    // concurrent lookup write cannot slip in between this read and the
    // update.
    const ownedQuery = trx
      .selectFrom('medias')
      .innerJoin('actors', 'medias.actorId', 'actors.id')
      .select(MEDIA_SELECT)
      .select('medias.createdAt as mediaCreatedAt')
      .where('medias.id', '=', id)
      .where('actors.accountId', '=', accountId)
      .$if(Boolean(actorId), (qb) => qb.where('medias.actorId', '=', actorId!))
      .limit(1)
    const ownedRow = await (
      details ? forUpdate(trx, ownedQuery, 'medias') : ownedQuery
    ).executeTakeFirst()
    if (!ownedRow) return null
    const owned = asMediaRow(ownedRow)

    // Only touch fields the caller actually provided so a partial update can't
    // blank out existing metadata (e.g. a description-only update must not
    // clear focus, and a focus-only update must not clear the description).
    const updates: MediaColumns = { updatedAt: new Date() }

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

    const detailsColumns = getDetailsColumns(details, parseMediaDetails(owned))
    Object.assign(updates, detailsColumns)
    const sortAt = resolveSortAtUpdate(detailsColumns, ownedRow.mediaCreatedAt)
    if (sortAt !== undefined) {
      updates.sortAt = sortAt
    }

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
        thumbnail.bytes - parseCounterValue(owned.thumbnailBytes)
    }

    await trx.updateTable('medias').set(updates).where('id', '=', id).execute()

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

    const data = await selectMediaRow(trx, id)
    if (!data) return null

    return { media: parseMediaRow(data), replacedThumbnailPath }
  })
}

export const deleteAttachmentsByIds = async (
  db: Db,
  { attachmentIds }: DeleteAttachmentsByIdsParams
): Promise<number> => {
  if (attachmentIds.length === 0) {
    return 0
  }

  const { numDeletedRows } = await db
    .deleteFrom('attachments')
    .where('id', 'in', attachmentIds)
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const deleteMedia = async (
  db: Db,
  { mediaId }: DeleteMediaParams
): Promise<boolean> => (await deleteMediaById(db, mediaId)).status === 'deleted'

export const deleteMediaWithFiles = (
  db: Db,
  { mediaId }: DeleteMediaParams
): Promise<DeleteMediaWithFilesResult> => deleteMediaById(db, mediaId)

export const deleteMediaForAccount = async (
  db: Db,
  { mediaId, accountId }: DeleteMediaForAccountParams
): Promise<DeleteMediaForAccountResult> => {
  const mediaRowId = toMediaRowId(mediaId)
  if (mediaRowId === null) return { status: 'not-found' }

  return inTransaction(
    db,
    async (trx): Promise<DeleteMediaForAccountResult> => {
      // Owner scope: only the account that owns the media (via its actors) can
      // delete it. Mastodon scopes destroy to `current_account.media_attachments`.
      const media = await trx
        .selectFrom('medias')
        .innerJoin('actors', 'medias.actorId', 'actors.id')
        .select(['medias.id', 'medias.actorId'])
        .where('medias.id', '=', mediaRowId)
        .where('actors.accountId', '=', accountId)
        .limit(1)
        // The join to the owner's actor row makes it non-null.
        .$narrowType<{ actorId: NotNull }>()
        .executeTakeFirst()
      if (!media) return { status: 'not-found' }

      // Mastodon's destroy returns 422 (in_usage_error) when the attachment is
      // already tied to a posted status, rather than deleting it. Match via a
      // medias↔attachments join (column-to-column), the same join
      // getMediasWithStatusForAccount uses.
      const attached = await trx
        .selectFrom('attachments')
        .innerJoin('medias', 'medias.id', 'attachments.mediaId')
        .select('attachments.id')
        .where('medias.id', '=', media.id)
        .limit(1)
        .executeTakeFirst()
      if (attached) return { status: 'in-use' }

      // The owner's album lock first, then the media row, then the album rows.
      await lockGalleryAlbumActor(trx, media.actorId)
      const locked = await lockMediaForDelete(trx, media.id)
      if (!locked) return { status: 'not-found' }
      const files = await deleteLockedMedia(trx, locked, accountId)
      // The paths are captured inside the transaction so the caller deletes
      // exactly the files that belonged to this row (no racy prefetch).
      return files ? { status: 'deleted', files } : { status: 'not-found' }
    }
  )
}

export const setMediaSubjectLookup = async (
  db: Db,
  { mediaId, expect, patch }: SetMediaSubjectLookupParams
): Promise<boolean> => {
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

  const updates: MediaColumns = {
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

  const { numUpdatedRows } = await db
    .updateTable('medias')
    .set(updates)
    .where('id', '=', id)
    .where(sameText('subjectName', expect.subjectName))
    .where(sameText('subjectScientificName', expect.subjectScientificName))
    .where(sameText('subjectTaxonKey', expect.subjectTaxonKey))
    .$if(expect.subjectCategory !== undefined, (qb) =>
      qb.where(sameText('subjectCategory', expect.subjectCategory!))
    )
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

export const setMediaPlaceLookup = async (
  db: Db,
  { mediaId, expect, patch }: SetMediaPlaceLookupParams
): Promise<boolean> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return false

  const { placeLookupStatus } = patch
  if (
    placeLookupStatus !== null &&
    parseLookupStatus(placeLookupStatus) === null
  ) {
    throw new Error(`Unknown place lookup status: ${placeLookupStatus}`)
  }

  const updates: MediaColumns = {
    placeLookupStatus,
    placeLookupAt: new Date(patch.placeLookupAt ?? Date.now())
  }
  if (patch.placeCountryCode !== undefined) {
    const code = patch.placeCountryCode?.trim().toUpperCase() || null
    updates.placeCountryCode = parseCountryCode(code)
  }

  const matchesPoint = (
    query: UpdateQueryBuilder<DB, 'medias', 'medias', UpdateResult>
  ) =>
    query
      .where('id', '=', id)
      .where(sameNumber('placeLatitude', expect.placeLatitude))
      .where(sameNumber('placeLongitude', expect.placeLongitude))

  return inTransaction(db, async (trx) => {
    const { numUpdatedRows } = await matchesPoint(trx.updateTable('medias'))
      .set(updates)
      .executeTakeFirst()
    if (Number(numUpdatedRows) === 0) return false

    if (patch.placeName !== undefined) {
      const placeName = patch.placeName?.trim().slice(0, 255) || null
      // Never replaces the owner's own name: only a missing name, or one the
      // geocoder wrote itself (a legacy null source counts as the owner's).
      await matchesPoint(trx.updateTable('medias'))
        .where((eb) =>
          eb.or([
            eb('placeName', 'is', null),
            eb('placeNameSource', '=', 'geocoder')
          ])
        )
        .set({
          placeName,
          placeNameSource: placeName === null ? null : 'geocoder'
        })
        .execute()
    }
    return true
  })
}

export const setMediaSubjectSuggestions = async (
  db: Db,
  { mediaId, suggestions }: SetMediaSubjectSuggestionsParams
): Promise<boolean> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return false

  const value = suggestions === null ? null : JSON.stringify(suggestions)
  if (
    value !== null &&
    Buffer.byteLength(value, 'utf8') > MAX_SUBJECT_SUGGESTIONS_BYTES
  ) {
    return false
  }
  const { numUpdatedRows } = await db
    .updateTable('medias')
    .set({ subjectSuggestions: value })
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}
