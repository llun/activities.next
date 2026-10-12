import type { Selectable } from 'kysely'

import {
  MEDIA_SELECT,
  asMediaRow,
  parseMediaRow,
  toMediaRowId
} from '@/lib/database/domains/media/rows'
import type {
  AttachmentWithMedia,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetAttachmentsWithMediaParams,
  GetMediaByIdParams,
  GetMediaByIdsForAccountParams,
  GetMediaWithAttachedStatusIdsParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  Media,
  MediaWithAttachedStatusIds,
  PaginatedMediaWithStatus
} from '@/lib/database/domains/media/types'
import {
  createAttachment,
  createMedia,
  deleteAttachmentsByIds,
  deleteMedia,
  deleteMediaForAccount,
  deleteMediaWithFiles,
  markMediaUploadVerified,
  replaceRemoteAttachmentsForStatus,
  setMediaPlaceLookup,
  setMediaSubjectLookup,
  setMediaSubjectSuggestions,
  updateAttachmentPlayback,
  updateMedia
} from '@/lib/database/domains/media/writes'
import type { Db } from '@/lib/database/kysely'
import { getCounterValue } from '@/lib/database/kysely/counter'
import type { Attachments } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { actorVisibleStatusIds } from '@/lib/database/kysely/visibility/actorVisible'
import { CounterKey } from '@/lib/database/utils/counter'
import { Attachment } from '@/lib/types/domain/attachment'

// The media reads. The writes (create, upload verification, updates, the
// lookup compare-and-sets, deletes and the attachment writes) are in
// ./writes.ts; `mediaQueries` at the end holds both.

// Knex read the arguments of limit() and offset() through parseInt and
// dropped a NaN one (with a warning), and refused a negative offset; Kysely
// binds whatever it is given. The settings page still hands a NaN page over
// for `?page=abc`, which Knex answered with the first page, so the paging
// values are read the same way here.
const pagingInteger = (value: number): number | null => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? null : parsed
}

const pagingOffset = (value: number): number | null => {
  const offset = pagingInteger(value)
  if (offset !== null && offset < 0) {
    throw new Error('A non-negative integer must be provided to offset.')
  }
  return offset
}

type AttachmentRow = Selectable<Attachments>

// An `attachments` row as the domain Attachment, or null for a row with no
// actor (which no reader can attribute).
const toAttachment = (row: AttachmentRow): Attachment | null => {
  if (!row.actorId) return null
  return Attachment.parse({
    ...row,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    // The domain carries media ids as strings, like `Media.id`.
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
    playbackType: row.playbackType ?? undefined
  })
}

const toAttachments = (rows: AttachmentRow[]): Attachment[] =>
  rows.map(toAttachment).filter((item): item is Attachment => item !== null)

export const getAttachments = async (
  db: Db,
  { statusId }: GetAttachmentsParams
): Promise<Attachment[]> => {
  const rows = await db
    .selectFrom('attachments')
    .selectAll()
    .where('statusId', '=', statusId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()
  return toAttachments(rows)
}

export const getAttachmentsWithMedia = async (
  db: Db,
  { statusId }: GetAttachmentsWithMediaParams
): Promise<AttachmentWithMedia[]> => {
  const rows = await db
    .selectFrom('attachments')
    .select([
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
    ])
    .where('statusId', '=', statusId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()
  return toAttachments(rows).map(
    (attachment) =>
      ({
        ...attachment,
        mediaId: attachment.mediaId ?? null
      }) satisfies AttachmentWithMedia
  )
}

// An attachment inherits its status's audience: filtering `statusId` by the
// same set `getActorStatuses` uses keeps a followers-only post's images out of
// a stranger's media gallery. No audience flags is the deliberate unfiltered
// mode (the owner's own gallery).
export const getAttachmentsForActor = async (
  db: Db,
  {
    actorId,
    limit = 25,
    maxCreatedAt,
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience
  }: GetAttachmentsForActorParams
): Promise<Attachment[]> => {
  const visibleStatusIds = actorVisibleStatusIds(db, actorId, {
    publicOnly,
    visibleToActorId,
    includeFollowersOnly,
    followersAudience
  })
  const limitValue = pagingInteger(limit)
  const rows = await db
    .selectFrom('attachments')
    .selectAll()
    .where('actorId', '=', actorId)
    .$if(visibleStatusIds !== null, (qb) =>
      qb.where('attachments.statusId', 'in', visibleStatusIds!)
    )
    .$if(Boolean(maxCreatedAt), (qb) =>
      qb.where('createdAt', '<', timestampValue(maxCreatedAt!))
    )
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .$if(limitValue !== null, (qb) => qb.limit(limitValue!))
    .execute()
  return toAttachments(rows)
}

export const getMediasWithStatusForAccount = async (
  db: Db,
  { accountId, limit = 100, page = 1, maxCreatedAt }: GetMediasForAccountParams
): Promise<PaginatedMediaWithStatus> => {
  const limitValue = pagingInteger(limit)
  const offsetValue = pagingOffset((page - 1) * limit)
  // The total comes from the account's counter, not a count of the rows.
  const [total, rows] = await Promise.all([
    getCounterValue(db, CounterKey.totalMedia(accountId)),
    db
      .selectFrom('medias')
      .innerJoin('actors', 'medias.actorId', 'actors.id')
      .select(MEDIA_SELECT)
      .where('actors.accountId', '=', accountId)
      .$if(Boolean(maxCreatedAt), (qb) =>
        qb.where('medias.createdAt', '<', timestampValue(maxCreatedAt!))
      )
      .orderBy('medias.createdAt', 'desc')
      .orderBy('medias.id', 'desc')
      .$if(limitValue !== null, (qb) => qb.limit(limitValue!))
      .$if(offsetValue !== null, (qb) => qb.offset(offsetValue!))
      .execute()
  ])

  if (rows.length === 0) return { items: [], total }

  const numericIds = rows
    .map((row) => toMediaRowId(String(row.id)))
    .filter((id): id is number => id !== null)

  // The status a media was posted with: the lowest status id among the
  // account's own attachments of it. Two bindings besides the ids.
  const statusIdByMediaId = new Map<string, string>()
  const attachmentRows = await selectInChunks(
    db,
    numericIds,
    (chunk) =>
      db
        .selectFrom('attachments')
        .innerJoin('medias', 'medias.id', 'attachments.mediaId')
        .innerJoin('actors', 'attachments.actorId', 'actors.id')
        .where('actors.accountId', '=', accountId)
        .where('medias.id', 'in', chunk)
        .where('attachments.statusId', 'is not', null)
        .where('attachments.statusId', '<>', '')
        .groupBy('medias.id')
        .select((eb) => [
          'medias.id as mediaId',
          eb.fn.min('attachments.statusId').as('statusId')
        ])
        .execute(),
    2
  )
  for (const row of attachmentRows) {
    if (row.statusId) statusIdByMediaId.set(String(row.mediaId), row.statusId)
  }

  const items = rows.map((row) => {
    const media = parseMediaRow(asMediaRow(row))
    const statusId = statusIdByMediaId.get(media.id)
    return { ...media, ...(statusId ? { statusId } : {}) }
  })
  return { items, total }
}

export const getMediaByIdForAccount = async (
  db: Db,
  { mediaId, accountId }: GetMediaByIdParams
): Promise<Media | null> => {
  // A malformed id is a miss, not a PostgreSQL error; see toMediaRowId.
  const id = toMediaRowId(mediaId)
  if (id === null) return null

  const row = await db
    .selectFrom('medias')
    .innerJoin('actors', 'medias.actorId', 'actors.id')
    .select(MEDIA_SELECT)
    .where('medias.id', '=', id)
    .where('actors.accountId', '=', accountId)
    .limit(1)
    .executeTakeFirst()
  return row ? parseMediaRow(asMediaRow(row)) : null
}

export const getMediaByIdsForAccount = async (
  db: Db,
  { mediaIds, accountId }: GetMediaByIdsForAccountParams
): Promise<Media[]> => {
  // Empty or malformed ids are dropped rather than sent; see toMediaRowId.
  const numericIds = mediaIds
    .map(toMediaRowId)
    .filter((id): id is number => id !== null)
  if (numericIds.length === 0) return []

  const rows = await db
    .selectFrom('medias')
    .innerJoin('actors', 'medias.actorId', 'actors.id')
    .select(MEDIA_SELECT)
    .where('medias.id', 'in', numericIds)
    .where('actors.accountId', '=', accountId)
    .execute()
  return rows.map((row) => parseMediaRow(asMediaRow(row)))
}

// A media row and the statuses it is attached to, for the public details
// endpoint, which pairs it with a status visibility check.
export const getMediaWithAttachedStatusIds = async (
  db: Db,
  { mediaId }: GetMediaWithAttachedStatusIdsParams
): Promise<MediaWithAttachedStatusIds | null> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return null

  const row = await db
    .selectFrom('medias')
    .select(MEDIA_SELECT)
    .where('medias.id', '=', id)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null

  // Only an attachment written by the media's OWNER counts as evidence the
  // owner published it. `attachments.mediaId` is a bare pointer any actor can
  // write (the outbox takes attachment objects from the client), so without
  // this an attacker's public post pointing at someone else's media id would
  // unlock that media's private details. Ownership is account-wide, matching
  // the upload and attach routes: another actor of the owner's account
  // attaching the media still counts.
  const rows = await db
    .selectFrom('attachments')
    .innerJoin('medias', 'medias.id', 'attachments.mediaId')
    .innerJoin(
      'actors as attachmentActors',
      'attachmentActors.id',
      'attachments.actorId'
    )
    .innerJoin('actors as mediaActors', 'mediaActors.id', 'medias.actorId')
    .where('medias.id', '=', id)
    .where((eb) =>
      eb.or([
        eb('attachments.actorId', '=', eb.ref('medias.actorId')),
        eb.and([
          eb('mediaActors.accountId', 'is not', null),
          eb('attachmentActors.accountId', '=', eb.ref('mediaActors.accountId'))
        ])
      ])
    )
    .where('attachments.statusId', 'is not', null)
    .where('attachments.statusId', '<>', '')
    .select('attachments.statusId')
    .distinct()
    .execute()

  return {
    media: parseMediaRow(asMediaRow(row)),
    statusIds: rows.map((attachment) => attachment.statusId as string)
  }
}

export const getStorageUsageForAccount = (
  db: Db,
  { accountId }: GetStorageUsageForAccountParams
): Promise<number> => getCounterValue(db, CounterKey.mediaUsage(accountId))

// The facade getSQLDatabase binds with bindDb().
export const mediaQueries = {
  setMediaSubjectLookup,
  setMediaPlaceLookup,
  setMediaSubjectSuggestions,
  createMedia,
  getMediaWithAttachedStatusIds,
  markMediaUploadVerified,
  createAttachment,
  updateAttachmentPlayback,
  getAttachments,
  replaceRemoteAttachmentsForStatus,
  getAttachmentsWithMedia,
  getAttachmentsForActor,
  getMediasWithStatusForAccount,
  getMediaByIdForAccount,
  getMediaByIdsForAccount,
  updateMedia,
  getStorageUsageForAccount,
  deleteAttachmentsByIds,
  deleteMedia,
  deleteMediaWithFiles,
  deleteMediaForAccount
}
