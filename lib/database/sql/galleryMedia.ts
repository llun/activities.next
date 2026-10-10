import { Knex } from 'knex'

import {
  MEDIA_COLUMNS,
  MediaRow,
  parseCountryCode,
  parseIucnCategory,
  parseLookupStatus,
  parseMediaRow,
  parsePlaceNameSource,
  parseTaxonPath,
  toMediaRowId
} from '@/lib/database/sql/media'
import { buildActorVisibleStatusIdsQuery } from '@/lib/database/sql/status'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getWhereInBatchSize,
  isSQLiteClient
} from '@/lib/database/sql/utils/knex'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import {
  GalleryShow,
  IucnCategory,
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES,
  MediaLookupStatus,
  MediaPlaceNameSource,
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import type { Media } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'

// The gallery's reads. What "gallery media" means is decided in exactly one
// place, `buildGalleryMediaScope`, and every method below goes through it:
//
//   medias.actorId = owner AND medias.inGallery = true
//   AND EXISTS an attachment of that media, written by the owner, on a status
//       of the owner's that the audience may read
//
// so an unposted upload never appears (not even to the owner), a deleted post
// drops its photos (attachments are deleted with their status), and a viewer
// sees exactly the photos of the posts they could read on the profile. The
// status filter is `buildActorVisibleStatusIdsQuery`, the same subquery the
// profile's posts and Media tab use — never re-derived here.
//
// Only the owner's "All media" list may widen the first condition, through the
// `show` option (`all`, `in_gallery`, `hidden`). It is read for the owner
// audience alone: any other audience is scoped to `inGallery = true` whatever
// `show` says, so a request parameter can never reach a hidden photo.

/** A gallery photo or video together with the post it is shown through. */
export interface GalleryMediaRow {
  media: Media
  // The newest attachment of this media on a status the audience may read —
  // never one on a post the audience may not see.
  attachment: Attachment
  statusId: string
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
  // The chosen attachment's thumbnail, or its url when it is an image.
  thumbnailUrl: string | null
  statusId: string
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
  // Owner only (ignored for a viewer): which posted media to list.
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
  // Owner only (ignored for a viewer): which posted media to index.
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
  // Owner-only: every POSTED media of the actor using one of the gear ids,
  // in the gallery or not (EXIF dates show real use either way).
  getGalleryGearUsageRows(
    params: GetGalleryGearUsageRowsParams
  ): Promise<GalleryGearUsageRow[]>
}

const ATTACHMENTS = 'gallery_attachments'
const STATUSES = 'gallery_statuses'

// Bindings a scoped query spends beyond its `whereIn` list: the actor id a few
// times, the empty string, and the visibility subquery's own (the public one
// is a recursive CTE). Generous, so SQLite's 999-variable cap is never hit.
const RESERVED_BINDINGS = 64

// The precisions the public map may show. Anything else is never even read for
// a viewer.
const PUBLIC_MAP_PRECISIONS: MediaPlacePrecision[] = ['area', 'exact']

/**
 * The status ids of `actorId` the audience may read, or `null` for the
 * owner's unfiltered view.
 *
 * Fails closed twice over: only `kind: 'owner'` (checked exactly) is
 * unfiltered, and a viewer whose flags are all falsy — which
 * `buildActorVisibleStatusIdsQuery` would answer with `null`, "no filter" — is
 * coerced to `publicOnly`.
 */
const buildGalleryVisibleStatusIds = (
  database: Knex,
  actorId: string,
  audience: GalleryAudience
): Knex.QueryBuilder | null => {
  if (audience?.kind === 'owner') return null

  const viewer = audience?.kind === 'viewer' ? audience : null
  const scoped = buildActorVisibleStatusIdsQuery({
    database,
    actorId,
    publicOnly: viewer?.publicOnly === true,
    visibleToActorId: viewer?.visibleToActorId ?? null,
    includeFollowersOnly: viewer?.includeFollowersOnly === true,
    followersAudience: viewer?.followersAudience ?? null
  })
  if (scoped) return scoped

  const publicOnly = buildActorVisibleStatusIdsQuery({
    database,
    actorId,
    publicOnly: true
  })
  // `publicOnly: true` always yields a subquery; refusing here keeps an
  // unexpected change in that builder from ever reading as "no filter".
  if (!publicOnly) {
    throw new Error('Gallery visibility subquery is unexpectedly unfiltered')
  }
  return publicOnly
}

/**
 * Narrows a query over `attachments as gallery_attachments` to attachments the
 * owner wrote on a status of their own that the audience may read.
 *
 * `attachments.actorId = owner` is what keeps another actor's post that points
 * at the owner's media id (any actor can write `attachments.mediaId`) from
 * unlocking it. The join to `statuses` drops an attachment whose status row is
 * gone, even in the owner's unfiltered mode.
 */
const scopePostedAttachments = (
  database: Knex,
  query: Knex.QueryBuilder,
  actorId: string,
  audience: GalleryAudience
): Knex.QueryBuilder => {
  query
    .innerJoin(
      `statuses as ${STATUSES}`,
      `${STATUSES}.id`,
      `${ATTACHMENTS}.statusId`
    )
    .where(`${ATTACHMENTS}.actorId`, actorId)
    .where(`${STATUSES}.actorId`, actorId)
    .whereNotNull(`${ATTACHMENTS}.statusId`)
    .where(`${ATTACHMENTS}.statusId`, '<>', '')

  const visibleStatusIds = buildGalleryVisibleStatusIds(
    database,
    actorId,
    audience
  )
  if (visibleStatusIds) {
    query.whereIn(`${ATTACHMENTS}.statusId`, visibleStatusIds)
  }
  return query
}

/**
 * The `medias.id` side of a `medias` to `attachments.mediaId` comparison.
 *
 * `attachments.mediaId` is varchar on SQLite and integer on PostgreSQL/MySQL.
 * Compared with the integer `medias.id`, SQLite applies numeric affinity to the
 * varchar side, so the comparison cannot use `attachments_mediaId_idx` and the
 * EXISTS probe falls back to scanning the owner's attachments for every media
 * row. Casting `medias.id` to TEXT keeps the comparison textual and the index
 * usable. This relies on the column holding the canonical `String(id)` ('12',
 * not '12.0' or '012'): `createAttachment` canonicalizes what it writes, and
 * every other writer stringifies a `medias.id`. PostgreSQL and MySQL keep the
 * plain reference so the engine coerces it its own way.
 */
export const mediaIdRef = (database: Knex) =>
  isSQLiteClient(database)
    ? database.raw('CAST(?? AS TEXT)', ['medias.id'])
    : database.ref('medias.id')

/**
 * Applies the gallery scope to a query over `medias`. `requireInGallery: false`
 * is only for the owner's gear usage, which counts every posted photo.
 *
 * `show` narrows the owner's view of posted media (`all` adds no `inGallery`
 * condition, `hidden` requires it to be false). It is honoured for the owner
 * audience only; every other audience keeps `inGallery = true`.
 */
export const buildGalleryMediaScope = (
  database: Knex,
  actorId: string,
  audience: GalleryAudience,
  {
    requireInGallery = true,
    show
  }: { requireInGallery?: boolean; show?: GalleryShow } = {}
) => {
  const effectiveShow: GalleryShow =
    audience?.kind === 'owner' && show !== undefined ? show : 'in_gallery'
  return (query: Knex.QueryBuilder): Knex.QueryBuilder => {
    query.where('medias.actorId', actorId)
    // Bound as `true`/`false`; SQLite stores the column as 0/1 and knex binds
    // 1/0.
    if (requireInGallery && effectiveShow !== 'all') {
      query.where('medias.inGallery', effectiveShow === 'in_gallery')
    }

    // See `mediaIdRef` for why SQLite compares against the text form.
    const posted = database(`attachments as ${ATTACHMENTS}`)
      .select(database.raw('1'))
      .where(`${ATTACHMENTS}.mediaId`, mediaIdRef(database))
    scopePostedAttachments(database, posted, actorId, audience)
    query.whereExists(posted)
    return query
  }
}

export const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

export const parseNullableTime = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const time = getCompatibleTime(value as number | string | Date)
  return Number.isFinite(time) ? time : null
}

const parseCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseCategory = (value: unknown): MediaSubjectCategory | null =>
  typeof value === 'string' &&
  (MEDIA_SUBJECT_CATEGORIES as readonly string[]).includes(value)
    ? (value as MediaSubjectCategory)
    : null

const parsePrecision = (value: unknown): MediaPlacePrecision | null =>
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

type AttachmentRow = Record<string, unknown> & {
  galleryMediaId: string | number
  galleryStatusPublicId: string | null
}

const parseAttachmentRow = (row: AttachmentRow): Attachment | null => {
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

interface PickedAttachment {
  attachment: Attachment
  statusId: string
  statusPublicId: string | null
}

const sortByIdDesc = <T>(rows: T[], getId: (row: T) => string | number) =>
  rows.sort((a, b) => Number(getId(b)) - Number(getId(a)))

export const GalleryMediaSQLDatabaseMixin = (
  database: Knex
): GalleryMediaDatabase => {
  /**
   * The attachment each media is shown through: the newest one (by
   * `createdAt`, then `id`) on a status the audience may read. One query per
   * `whereIn` chunk, never one per media. The newest is picked in JS so the
   * comparison is on parsed times, never on SQLite's mixed storage types.
   */
  const pickAttachments = async (
    actorId: string,
    audience: GalleryAudience,
    mediaIds: Array<string | number>
  ): Promise<Map<string, PickedAttachment>> => {
    const rowIds = [
      ...new Set(
        mediaIds
          .map((id) => toMediaRowId(String(id)))
          .filter((id): id is number => id !== null)
      )
    ]
    const picked = new Map<string, PickedAttachment>()
    if (rowIds.length === 0) return picked

    for (const chunk of chunkArray(
      rowIds,
      getWhereInBatchSize(database, RESERVED_BINDINGS)
    )) {
      const query = database(`attachments as ${ATTACHMENTS}`)
        .innerJoin('medias', (join) =>
          join.on(`${ATTACHMENTS}.mediaId`, '=', mediaIdRef(database))
        )
        .whereIn('medias.id', chunk)
        .where('medias.actorId', actorId)
      scopePostedAttachments(database, query, actorId, audience)
      const rows: AttachmentRow[] = await query.select(
        `${ATTACHMENTS}.*`,
        `${STATUSES}.publicId as galleryStatusPublicId`,
        'medias.id as galleryMediaId'
      )

      for (const row of rows) {
        const attachment = parseAttachmentRow(row)
        if (!attachment) continue
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
    actorId: string,
    audience: GalleryAudience,
    rows: MediaRow[]
  ): Promise<GalleryMediaRow[]> => {
    const picked = await pickAttachments(
      actorId,
      audience,
      rows.map((row) => row.id)
    )
    // A media whose last visible post went away between the two reads has no
    // attachment to be shown through, and is dropped rather than shown bare.
    return rows.flatMap((row) => {
      const pick = picked.get(String(row.id))
      return pick ? [{ media: parseMediaRow(row), ...pick }] : []
    })
  }

  const selectMediaColumns = () =>
    database('medias').select(MEDIA_COLUMNS.map((column) => `medias.${column}`))

  return {
    async getActorHasGalleryMedia({ actorId, audience }) {
      const query = database('medias').select(database.raw('1'))
      buildGalleryMediaScope(database, actorId, audience)(query)
      const row = await query.first()
      return Boolean(row)
    },

    async getGalleryMedia({ actorId, audience, maxId, limit, gearId, show }) {
      const size = normalizeLimit(limit)
      if (size === 0) return []

      let maxRowId: number | null = null
      if (maxId !== undefined) {
        maxRowId = toMediaRowId(maxId)
        if (maxRowId === null) return []
      }

      const query = selectMediaColumns()
      buildGalleryMediaScope(database, actorId, audience, { show })(query)
      if (maxRowId !== null) query.where('medias.id', '<', maxRowId)
      if (gearId !== undefined) {
        query.where((builder) =>
          builder
            .where('medias.cameraGearId', gearId)
            .orWhere('medias.lensGearId', gearId)
        )
      }
      const rows: MediaRow[] = await query
        .orderBy('medias.id', 'desc')
        .limit(size)

      return toGalleryMediaRows(actorId, audience, rows)
    },

    async getGalleryMediaByIds({ actorId, audience, mediaIds, show }) {
      const rowIds = [
        ...new Set(
          mediaIds
            .map((id) => toMediaRowId(String(id)))
            .filter((id): id is number => id !== null)
        )
      ]
      if (rowIds.length === 0) return []

      const rows: MediaRow[] = []
      for (const chunk of chunkArray(
        rowIds,
        getWhereInBatchSize(database, RESERVED_BINDINGS)
      )) {
        const query = selectMediaColumns().whereIn('medias.id', chunk)
        buildGalleryMediaScope(database, actorId, audience, { show })(query)
        rows.push(...((await query) as MediaRow[]))
      }

      return toGalleryMediaRows(
        actorId,
        audience,
        sortByIdDesc(rows, (row) => row.id)
      )
    },

    async getGalleryMediaIndex({ actorId, audience, limit, maxId, show }) {
      const size = normalizeLimit(limit)
      if (size === 0) return []

      let maxRowId: number | null = null
      if (maxId !== undefined) {
        maxRowId = toMediaRowId(maxId)
        if (maxRowId === null) return []
      }

      const query = database('medias').select(
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
      )
      buildGalleryMediaScope(database, actorId, audience, { show })(query)
      if (maxRowId !== null) query.where('medias.id', '<', maxRowId)
      const rows: Array<Record<string, unknown>> = await query
        .orderBy('medias.id', 'desc')
        .limit(size)

      return rows.map(toGalleryIndexRow)
    },

    async getGalleryMapRows({ actorId, audience, limit }) {
      const size = normalizeLimit(limit)
      if (size === 0) return []

      const query = database('medias')
        .select(
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
          'medias.takenAt'
        )
        .whereNotNull('medias.placeLatitude')
        .whereNotNull('medias.placeLongitude')
      buildGalleryMediaScope(database, actorId, audience)(query)
      if (audience?.kind !== 'owner') {
        // Narrowed in SQL so hidden-precision rows cannot use up the cap; the
        // projection still checks every point it discloses.
        query.whereIn('medias.placePrecision', PUBLIC_MAP_PRECISIONS)
      }
      const rows: Array<Record<string, unknown>> = await query
        .orderBy('medias.id', 'desc')
        .limit(size)

      const picked = await pickAttachments(
        actorId,
        audience,
        rows.map((row) => row.id as string | number)
      )

      return rows.flatMap((row): GalleryMapRow[] => {
        const id = String(row.id)
        const pick = picked.get(id)
        const latitude = parseCoordinate(row.placeLatitude)
        const longitude = parseCoordinate(row.placeLongitude)
        if (!pick || latitude === null || longitude === null) return []

        const { attachment } = pick
        return [
          {
            id,
            latitude,
            longitude,
            placePrecision: parsePrecision(row.placePrecision),
            placeName: (row.placeName as string | null) ?? null,
            placeCountryCode: parseCountryCode(row.placeCountryCode),
            placeNameSource: parsePlaceNameSource(row.placeNameSource),
            subjectName: (row.subjectName as string | null) ?? null,
            subjectScientificName:
              (row.subjectScientificName as string | null) ?? null,
            subjectCategory: parseCategory(row.subjectCategory),
            subjectTaxonKey: (row.subjectTaxonKey as string | null) ?? null,
            subjectIucnCategory: parseIucnCategory(row.subjectIucnCategory),
            subjectLookupStatus: parseLookupStatus(row.subjectLookupStatus),
            takenAt: parseNullableTime(row.takenAt),
            thumbnailUrl:
              attachment.thumbnailUrl ??
              (attachment.mediaType.startsWith('image/')
                ? attachment.url
                : null),
            statusId: pick.statusId,
            statusPublicId: pick.statusPublicId
          }
        ]
      })
    },

    async getGalleryGearUsageRows({ actorId, gearIds }) {
      const uniqueGearIds = [...new Set(gearIds.filter(Boolean))]
      if (uniqueGearIds.length === 0) return []

      const usage: GalleryGearUsageRow[] = []
      // Each id is bound twice (camera OR lens).
      const batchSize = Math.max(
        1,
        Math.floor(getWhereInBatchSize(database, RESERVED_BINDINGS) / 2)
      )
      for (const chunk of chunkArray(uniqueGearIds, batchSize)) {
        const inChunk = new Set(chunk)
        const query = database('medias')
          .select(
            'medias.id',
            'medias.cameraGearId',
            'medias.lensGearId',
            'medias.inGallery',
            'medias.originalMimeType',
            'medias.placeCountryCode',
            'medias.takenAt',
            'medias.createdAt'
          )
          .where((builder) =>
            builder
              .whereIn('medias.cameraGearId', chunk)
              .orWhereIn('medias.lensGearId', chunk)
          )
        buildGalleryMediaScope(
          database,
          actorId,
          { kind: 'owner' },
          { requireInGallery: false }
        )(query)
        const rows: Array<Record<string, unknown>> = await query.orderBy(
          'medias.id',
          'desc'
        )

        for (const row of rows) {
          const base = {
            mediaId: String(row.id),
            inGallery: Boolean(row.inGallery),
            originalMimeType: (row.originalMimeType as string | null) ?? '',
            placeCountryCode: parseCountryCode(row.placeCountryCode),
            takenAt: parseNullableTime(row.takenAt),
            createdAt: parseNullableTime(row.createdAt) ?? 0
          }
          for (const gearId of new Set([
            row.cameraGearId as string | null,
            row.lensGearId as string | null
          ])) {
            if (gearId && inChunk.has(gearId)) usage.push({ gearId, ...base })
          }
        }
      }
      return usage
    }
  }
}
