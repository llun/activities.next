import { Knex } from 'knex'

import { buildActorVisibleStatusIdsQuery } from '@/lib/database/sql/status'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import {
  AttachmentWithMedia,
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteAttachmentsByIdsParams,
  DeleteMediaByPathParams,
  DeleteMediaForAccountParams,
  DeleteMediaForAccountResult,
  DeleteMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetAttachmentsWithMediaParams,
  GetMediaByIdParams,
  GetMediaByIdsForAccountParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  MarkMediaUploadVerifiedParams,
  Media,
  MediaDatabase,
  PaginatedMediaWithStatus,
  UpdateMediaParams,
  UpdateMediaResult
} from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'

import { getCompatibleJSON } from './utils/getCompatibleJSON'
import { getCompatibleTime } from './utils/getCompatibleTime'

// PostgreSQL `integer` upper bound. An id above it does not merely miss: the
// driver sends it as a parameter to an integer column and PostgreSQL answers
// `value out of range for type integer` — the same 500 a non-numeric id caused.
// The repo's own attachments.mediaId migration bounds at this exact value.
const MAX_MEDIA_ROW_ID = 2147483647

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
const toMediaRowId = (mediaId: string): number | null => {
  if (!/^\d+(\.0+)?$/.test(mediaId)) return null
  const id = Number(mediaId)
  return id > 0 && id <= MAX_MEDIA_ROW_ID ? id : null
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

type MediaRow = {
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
}

type MediaMetaData = Media['original']['metaData']

const parseMediaMetaData = (
  input?: string | MediaMetaData | null
): MediaMetaData =>
  getCompatibleJSON<MediaMetaData>(input ?? ({} as MediaMetaData))

const parseMediaRow = (data: MediaRow): Media => ({
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
    : {})
})

// `medias` columns needed to rebuild a full Media row (used by every read).
const MEDIA_COLUMNS = [
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
  'focusY'
] as const

export const MediaSQLDatabaseMixin = (database: Knex): MediaDatabase => ({
  async createMedia({
    actorId,
    original,
    thumbnail,
    description,
    focus
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
        ...(focus ? { focusX: focus.x, focusY: focus.y } : null)
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
        ...(focus ? { focus } : null)
      } as Media
    })
  },
  async markMediaUploadVerified({
    mediaId,
    accountId,
    verifiedAt
  }: MarkMediaUploadVerifiedParams): Promise<Media | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    const data = await database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('medias.id', id)
      .where('actors.accountId', accountId)
      .select(
        'medias.id',
        'medias.actorId',
        'medias.original',
        'medias.originalBytes',
        'medias.originalMimeType',
        'medias.originalMetaData',
        'medias.originalFileName',
        'medias.thumbnail',
        'medias.thumbnailBytes',
        'medias.thumbnailMimeType',
        'medias.thumbnailMetaData',
        'medias.description',
        'medias.focusX',
        'medias.focusY'
      )
      .first<MediaRow>()

    if (!data) return null

    const media = parseMediaRow(data)
    const metaData = {
      ...media.original.metaData,
      upload: {
        ...media.original.metaData.upload,
        state: 'verified' as const,
        verifiedAt
      }
    }

    await database('medias')
      .where('id', media.id)
      .update({ originalMetaData: JSON.stringify(metaData) })

    return {
      ...media,
      original: {
        ...media.original,
        metaData
      }
    }
  },
  // NOTE: `mediaId` is WRITTEN here, not compared, so it does not go through
  // `toMediaRowId` — coercing would silently drop the link rather than surface
  // the caller's bad id. Almost every caller hands over an id read back out of
  // `medias`, but `POST /api/v1/accounts/outbox` does not: its
  // `PostBoxAttachment.id` is a bare `z.string()` that reaches
  // `lib/actions/createNote.ts` unvalidated, so a malformed id fails this
  // insert on PostgreSQL (`attachments.mediaId` is `integer` there) AFTER the
  // status row is already committed. That endpoint needs its own validation —
  // it is a separate bug from the lookup guard above, tracked separately.
  async createAttachment({
    actorId,
    statusId,
    mediaType,
    url,
    width,
    height,
    name = '',
    mediaId,
    createdAt
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
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    })
    await database('attachments').insert({
      ...data,
      mediaId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return data
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await database<Attachment>('attachments')
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
        'mediaId'
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
    let query = database<Attachment>('attachments')
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
      .leftJoin('attachments', 'medias.id', 'attachments.mediaId')
      .where('actors.accountId', accountId)
      .distinct(
        'medias.id',
        'medias.actorId',
        'medias.original',
        'medias.originalBytes',
        'medias.originalMimeType',
        'medias.originalMetaData',
        'medias.originalFileName',
        'medias.thumbnail',
        'medias.thumbnailBytes',
        'medias.thumbnailMimeType',
        'medias.thumbnailMetaData',
        'medias.description',
        'medias.focusX',
        'medias.focusY',
        'medias.createdAt',
        'attachments.statusId'
      )
      .orderBy('medias.createdAt', 'desc')

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

    const [total, data] = await Promise.all([totalPromise, itemsQuery])

    const items = data.map((item) => ({
      id: String(item.id),
      actorId: item.actorId,
      original: {
        path: item.original,
        bytes: Number(item.originalBytes),
        mimeType: item.originalMimeType,
        metaData: parseMediaMetaData(item.originalMetaData),
        ...(item.originalFileName ? { fileName: item.originalFileName } : {})
      },
      ...(item.thumbnail
        ? {
            thumbnail: {
              path: item.thumbnail,
              bytes: Number(item.thumbnailBytes),
              mimeType: item.thumbnailMimeType,
              metaData: parseMediaMetaData(item.thumbnailMetaData)
            }
          }
        : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.focusX !== null &&
      item.focusX !== undefined &&
      item.focusY !== null &&
      item.focusY !== undefined
        ? { focus: { x: Number(item.focusX), y: Number(item.focusY) } }
        : {}),
      ...(item.statusId ? { statusId: item.statusId } : {})
    }))

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
    description,
    focus,
    thumbnail
  }: UpdateMediaParams): Promise<UpdateMediaResult | null> {
    const id = toMediaRowId(mediaId)
    if (id === null) return null

    return database.transaction(async (trx) => {
      const owned = await trx('medias')
        .join('actors', 'medias.actorId', 'actors.id')
        .where('medias.id', id)
        .where('actors.accountId', accountId)
        .select('medias.id', 'medias.thumbnail', 'medias.thumbnailBytes')
        .first<{
          id: string | number
          thumbnail: string | null
          thumbnailBytes: number | string | null
        }>()
      if (!owned) return null

      // Only touch fields the caller actually provided so a partial update can't
      // blank out existing metadata (e.g. a description-only update must not
      // clear focus, and a focus-only update must not clear the description).
      const updates: {
        updatedAt: Date
        description?: string | null
        focusX?: number
        focusY?: number
        thumbnail?: string
        thumbnailBytes?: number
        thumbnailMimeType?: string
        thumbnailMetaData?: string
      } = { updatedAt: new Date() }

      if (description !== undefined) {
        updates.description = description
      }
      if (focus !== undefined) {
        updates.focusX = focus.x
        updates.focusY = focus.y
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
          'medias.original',
          'medias.thumbnail',
          'medias.originalBytes',
          'medias.thumbnailBytes'
        )
        .first<{
          id: string | number
          original: string
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
      const files = [
        media.original,
        ...(media.thumbnail ? [media.thumbnail] : [])
      ]
      return { status: 'deleted', files }
    })
  },

  async deleteMediaByPath({
    actorId,
    path
  }: DeleteMediaByPathParams): Promise<boolean> {
    return deleteMediaByConditions(database, { actorId, original: path })
  }
})
