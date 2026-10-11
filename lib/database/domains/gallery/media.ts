import { sql } from 'kysely'

import {
  type GalleryAttachmentRow,
  isPresent,
  normalizeLimit,
  parseCategory,
  parseCoordinate,
  parseGalleryAttachmentRow,
  parseNullableTime,
  parsePrecision,
  sortByIdDesc,
  toGalleryIndexRow,
  toRowIds,
  withLiveFile
} from '@/lib/database/domains/gallery/rows'
import type {
  AddMediaToGalleryParams,
  GalleryGearUsageRow,
  GalleryIndexRow,
  GalleryMapRow,
  GalleryMediaRow,
  GetActorHasGalleryMediaParams,
  GetGalleryGearUsageRowsParams,
  GetGalleryMapRowsParams,
  GetGalleryMediaByIdsParams,
  GetGalleryMediaIndexParams,
  GetGalleryMediaParams,
  GetUnattachedMediaParams
} from '@/lib/database/domains/gallery/types'
import {
  MEDIA_SELECT,
  type MediaRow,
  asMediaRow,
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parseMediaRow,
  parsePlaceNameSource,
  toMediaRowId
} from '@/lib/database/domains/media/rows'
import type { Media } from '@/lib/database/domains/media/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import {
  galleryMediaIdRef,
  galleryMediaScope,
  postedGalleryAttachment
} from '@/lib/database/kysely/visibility/galleryMedia'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import type { MediaPlacePrecision } from '@/lib/types/database/gallery'
import type { Attachment } from '@/lib/types/domain/attachment'

// The gallery's reads. What "gallery media" means is decided in exactly one
// place, `galleryMediaScope` (lib/database/kysely/visibility/galleryMedia.ts),
// and every read below goes through it. `show` (`all`, `in_gallery`,
// `hidden`, `not_posted`) narrows the owner's list; it is read for the owner
// audience only, so a request parameter can never reach a hidden or an
// unposted photo for anyone else.

// Bindings a scoped query spends beyond its `in` list: the actor id a few
// times, the empty string, and the visibility subquery's own (the public one
// is a recursive CTE). Generous, so SQLite's 999-variable cap is never hit.
const RESERVED_BINDINGS = 64

// The precisions the public map may show. Anything else is never even read for
// a viewer.
const PUBLIC_MAP_PRECISIONS: MediaPlacePrecision[] = ['area', 'exact']

interface PickedAttachment {
  attachment: Attachment
  statusId: string
  statusPublicId: string | null
}

/**
 * The attachment each media is shown through: the newest one (by `createdAt`,
 * then `id`) on a status the audience may read. One query per `in` chunk,
 * never one per media. The newest is picked in JS so the comparison is on
 * parsed times.
 */
const pickAttachments = async (
  db: Db,
  actorId: string,
  audience: GalleryAudience,
  mediaIds: Array<string | number>
): Promise<Map<string, PickedAttachment>> => {
  const rowIds = toRowIds(mediaIds)
  const picked = new Map<string, PickedAttachment>()
  if (rowIds.length === 0) return picked

  for (const chunk of chunkArray(
    rowIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const rows = (await db
      .selectFrom('attachments as gallery_attachments')
      .innerJoin('medias', (join) =>
        join.on('gallery_attachments.mediaId', '=', galleryMediaIdRef(db))
      )
      .innerJoin(
        'statuses as gallery_statuses',
        'gallery_statuses.id',
        'gallery_attachments.statusId'
      )
      .selectAll('gallery_attachments')
      .select([
        'gallery_statuses.publicId as galleryStatusPublicId',
        'medias.id as galleryMediaId',
        // The live file of the media, read with the attachment it is shown
        // through.
        'medias.original as galleryLivePath',
        'medias.originalMetaData as galleryLiveMetaData',
        'medias.blurhash as galleryLiveBlurhash',
        'medias.focusX as galleryLiveFocusX',
        'medias.focusY as galleryLiveFocusY',
        'medias.editedAt as galleryLiveEditedAt'
      ])
      .where('medias.id', 'in', chunk)
      .where('medias.actorId', '=', actorId)
      .where(postedGalleryAttachment(db, actorId, audience))
      .execute()) as GalleryAttachmentRow[]

    for (const row of rows) {
      const parsed = parseGalleryAttachmentRow(row)
      if (!parsed) continue
      const attachment = withLiveFile(parsed, row)
      const mediaId = String(row.galleryMediaId)
      const current = picked.get(mediaId)
      if (
        current &&
        (current.attachment.createdAt > attachment.createdAt ||
          (current.attachment.createdAt === attachment.createdAt &&
            current.attachment.id > attachment.id))
      ) {
        continue
      }
      picked.set(mediaId, {
        attachment,
        statusId: attachment.statusId,
        statusPublicId: row.galleryStatusPublicId ?? null
      })
    }
  }
  return picked
}

const toGalleryMediaRows = async (
  db: Db,
  actorId: string,
  audience: GalleryAudience,
  rows: MediaRow[]
): Promise<GalleryMediaRow[]> => {
  const picked = await pickAttachments(
    db,
    actorId,
    audience,
    rows.map((row) => row.id)
  )
  return rows.flatMap((row): GalleryMediaRow[] => {
    const pick = picked.get(String(row.id))
    if (pick) return [{ media: parseMediaRow(row), ...pick }]
    // Only the owner's own Gallery additions are shown without a post.
    // Anything else here lost its last visible post between the two reads,
    // and is dropped rather than shown bare.
    if (audience?.kind === 'owner' && isPresent(row.galleryAddedAt)) {
      return [
        {
          media: parseMediaRow(row),
          attachment: null,
          statusId: null,
          statusPublicId: null
        }
      ]
    }
    return []
  })
}

// `maxId` as the exclusive upper bound on `medias.id`: null without one,
// `false` for an id that is not a row id (which reads nothing).
const toMaxRowId = (maxId: string | undefined): number | null | false => {
  if (maxId === undefined) return null
  return toMediaRowId(maxId) ?? false
}

export const getActorHasGalleryMedia = async (
  db: Db,
  { actorId, audience }: GetActorHasGalleryMediaParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('medias')
    .select(sql.lit(1).as('one'))
    .where(galleryMediaScope(db, actorId, audience))
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const getGalleryMedia = async (
  db: Db,
  { actorId, audience, maxId, limit, gearId, show }: GetGalleryMediaParams
): Promise<GalleryMediaRow[]> => {
  const size = normalizeLimit(limit)
  if (size === 0) return []

  const maxRowId = toMaxRowId(maxId)
  if (maxRowId === false) return []

  const rows = await db
    .selectFrom('medias')
    .select(MEDIA_SELECT)
    .where(galleryMediaScope(db, actorId, audience, { show }))
    .$if(maxRowId !== null, (qb) => qb.where('medias.id', '<', maxRowId!))
    .$if(gearId !== undefined, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('medias.cameraGearId', '=', gearId!),
          eb('medias.lensGearId', '=', gearId!)
        ])
      )
    )
    .orderBy('medias.id', 'desc')
    .limit(size)
    .execute()

  return toGalleryMediaRows(db, actorId, audience, rows.map(asMediaRow))
}

export const getGalleryMediaByIds = async (
  db: Db,
  { actorId, audience, mediaIds, show }: GetGalleryMediaByIdsParams
): Promise<GalleryMediaRow[]> => {
  const rowIds = toRowIds(mediaIds)
  if (rowIds.length === 0) return []

  const rows: MediaRow[] = []
  for (const chunk of chunkArray(
    rowIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const chunkRows = await db
      .selectFrom('medias')
      .select(MEDIA_SELECT)
      .where('medias.id', 'in', chunk)
      .where(galleryMediaScope(db, actorId, audience, { show }))
      .execute()
    rows.push(...chunkRows.map(asMediaRow))
  }

  return toGalleryMediaRows(
    db,
    actorId,
    audience,
    sortByIdDesc(rows, (row) => row.id)
  )
}

export const getGalleryMediaIndex = async (
  db: Db,
  { actorId, audience, limit, maxId, show }: GetGalleryMediaIndexParams
): Promise<GalleryIndexRow[]> => {
  const size = normalizeLimit(limit)
  if (size === 0) return []

  const maxRowId = toMaxRowId(maxId)
  if (maxRowId === false) return []

  const rows = await db
    .selectFrom('medias')
    .select([
      'medias.id',
      'medias.subjectName',
      'medias.subjectScientificName',
      'medias.subjectCategory',
      'medias.subjectTaxonKey',
      'medias.subjectTaxonPath',
      'medias.subjectIucnCategory',
      'medias.subjectLookupStatus',
      'medias.placeName',
      'medias.placePrecision',
      'medias.placeLatitude',
      'medias.placeLongitude',
      'medias.placeCountryCode',
      'medias.placeNameSource',
      'medias.takenAt',
      'medias.createdAt'
    ])
    .where(galleryMediaScope(db, actorId, audience, { show }))
    .$if(maxRowId !== null, (qb) => qb.where('medias.id', '<', maxRowId!))
    .orderBy('medias.id', 'desc')
    .limit(size)
    .execute()

  return rows.map(toGalleryIndexRow)
}

export const getGalleryMapRows = async (
  db: Db,
  { actorId, audience, limit }: GetGalleryMapRowsParams
): Promise<GalleryMapRow[]> => {
  const size = normalizeLimit(limit)
  if (size === 0) return []

  const rows = await db
    .selectFrom('medias')
    .select([
      'medias.id',
      'medias.placeLatitude',
      'medias.placeLongitude',
      'medias.placePrecision',
      'medias.placeName',
      'medias.placeCountryCode',
      'medias.placeNameSource',
      'medias.subjectName',
      'medias.subjectScientificName',
      'medias.subjectCategory',
      'medias.subjectTaxonKey',
      'medias.subjectIucnCategory',
      'medias.subjectLookupStatus',
      'medias.takenAt',
      'medias.original',
      'medias.thumbnail',
      'medias.originalMimeType',
      'medias.galleryAddedAt'
    ])
    .where('medias.placeLatitude', 'is not', null)
    .where('medias.placeLongitude', 'is not', null)
    .where(galleryMediaScope(db, actorId, audience))
    // Narrowed in SQL so hidden-precision rows cannot use up the cap; the
    // projection still checks every point it discloses.
    .$if(audience?.kind !== 'owner', (qb) =>
      qb.where('medias.placePrecision', 'in', PUBLIC_MAP_PRECISIONS)
    )
    .orderBy('medias.id', 'desc')
    .limit(size)
    .execute()

  const picked = await pickAttachments(
    db,
    actorId,
    audience,
    rows.map((row) => row.id)
  )

  return rows.flatMap((row): GalleryMapRow[] => {
    const id = String(row.id)
    const pick = picked.get(id)
    const latitude = parseCoordinate(row.placeLatitude)
    const longitude = parseCoordinate(row.placeLongitude)
    if (latitude === null || longitude === null) return []
    // The owner's Gallery additions have no post to be shown through.
    if (
      !pick &&
      !(audience?.kind === 'owner' && isPresent(row.galleryAddedAt))
    ) {
      return []
    }

    const attachment = pick?.attachment ?? null
    return [
      {
        id,
        latitude,
        longitude,
        placePrecision: parsePrecision(row.placePrecision),
        placeName: row.placeName ?? null,
        placeCountryCode: parseCountryCode(row.placeCountryCode),
        placeNameSource: parsePlaceNameSource(row.placeNameSource),
        subjectName: row.subjectName ?? null,
        subjectScientificName: row.subjectScientificName ?? null,
        subjectCategory: parseCategory(row.subjectCategory),
        subjectTaxonKey: row.subjectTaxonKey ?? null,
        subjectIucnCategory: parseIucnCategory(row.subjectIucnCategory),
        subjectLookupStatus: parseLookupStatus(row.subjectLookupStatus),
        takenAt: parseNullableTime(row.takenAt),
        thumbnailUrl: attachment
          ? (attachment.thumbnailUrl ??
            (attachment.mediaType.startsWith('image/') ? attachment.url : null))
          : null,
        file: {
          path: String(row.original ?? ''),
          thumbnailPath: row.thumbnail ?? null,
          mimeType: String(row.originalMimeType ?? '')
        },
        statusId: pick?.statusId ?? null,
        statusPublicId: pick?.statusPublicId ?? null
      }
    ]
  })
}

export const getGalleryGearUsageRows = async (
  db: Db,
  { actorId, gearIds }: GetGalleryGearUsageRowsParams
): Promise<GalleryGearUsageRow[]> => {
  const uniqueGearIds = [...new Set(gearIds.filter(Boolean))]
  if (uniqueGearIds.length === 0) return []

  const usage: GalleryGearUsageRow[] = []
  // Each id is bound twice (camera OR lens).
  const batchSize = Math.max(
    1,
    Math.floor(getWhereInBatchSize(db, RESERVED_BINDINGS) / 2)
  )
  for (const chunk of chunkArray(uniqueGearIds, batchSize)) {
    const inChunk = new Set(chunk)
    const rows = await db
      .selectFrom('medias')
      .select([
        'medias.id',
        'medias.cameraGearId',
        'medias.lensGearId',
        'medias.inGallery',
        'medias.originalMimeType',
        'medias.placeCountryCode',
        'medias.takenAt',
        'medias.createdAt'
      ])
      .where((eb) =>
        eb.or([
          eb('medias.cameraGearId', 'in', chunk),
          eb('medias.lensGearId', 'in', chunk)
        ])
      )
      .where(
        galleryMediaScope(
          db,
          actorId,
          { kind: 'owner' },
          { requireInGallery: false }
        )
      )
      .orderBy('medias.id', 'desc')
      .execute()

    for (const row of rows) {
      const base = {
        mediaId: String(row.id),
        inGallery: Boolean(row.inGallery),
        originalMimeType: row.originalMimeType ?? '',
        placeCountryCode: parseCountryCode(row.placeCountryCode),
        takenAt: parseNullableTime(row.takenAt),
        createdAt: parseNullableTime(row.createdAt) ?? 0
      }
      for (const gearId of new Set([row.cameraGearId, row.lensGearId])) {
        if (gearId && inChunk.has(gearId)) usage.push({ gearId, ...base })
      }
    }
  }
  return usage
}

// The actor's own media among `chunk` that no attachment uses.
const unattachedMedia = (db: Db, chunk: number[], actorId: string) =>
  db
    .selectFrom('medias')
    .where('medias.id', 'in', chunk)
    .where('medias.actorId', '=', actorId)
    .where((eb) =>
      eb.not(
        eb.exists(
          db
            .selectFrom('attachments')
            .select(sql.lit(1).as('one'))
            .where('attachments.mediaId', '=', galleryMediaIdRef(db))
        )
      )
    )

export const getUnattachedMedia = async (
  db: Db,
  { actorId, mediaIds }: GetUnattachedMediaParams
): Promise<Media[]> => {
  const rowIds = toRowIds(mediaIds)
  const rows: MediaRow[] = []
  for (const chunk of chunkArray(
    rowIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const chunkRows = await unattachedMedia(db, chunk, actorId)
      .select(MEDIA_SELECT)
      .execute()
    rows.push(...chunkRows.map(asMediaRow))
  }
  return sortByIdDesc(rows, (row) => row.id).map(parseMediaRow)
}

export const addMediaToGallery = async (
  db: Db,
  { actorId, mediaIds }: AddMediaToGalleryParams
): Promise<string[]> => {
  const rowIds = toRowIds(mediaIds)
  if (rowIds.length === 0) return []

  const added: string[] = []
  const now = new Date()
  for (const chunk of chunkArray(
    rowIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    await inTransaction(db, async (trx) => {
      // Re-checked inside the write's own transaction: a media a status
      // started using meanwhile is not the unposted media this adds.
      const rows = await unattachedMedia(trx, chunk, actorId)
        .select('medias.id')
        .execute()
      if (rows.length === 0) return

      // `galleryAddedAt` keeps the first time, so a repeated call is a
      // no-op rather than moving the media to the front of the list.
      // `inGallery` is switched on only that first time: a photo the owner
      // has since hidden stays hidden when the same confirm is retried.
      await trx
        .updateTable('medias')
        .set({
          inGallery: sql<boolean>`case when ${sql.ref('galleryAddedAt')} is null then ${true} else ${sql.ref('inGallery')} end`,
          galleryAddedAt: sql<Date>`coalesce(${sql.ref('galleryAddedAt')}, ${now})`
        })
        .where(
          'id',
          'in',
          rows.map((row) => row.id)
        )
        .execute()
      added.push(...rows.map((row) => String(row.id)))
    })
  }
  return sortByIdDesc(added, (id) => id)
}
