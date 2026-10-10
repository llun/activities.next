import {
  type ApplyMediaEditParams,
  type ApplyMediaEditResult,
  type GetMediaEditFilePathsParams,
  type GetMediaEditStateParams,
  type ListMediaEditFilesParams,
  MEDIA_EDIT_MASK_PREFIX,
  MEDIA_EDIT_ORIGINAL_SLOT,
  MEDIA_EDIT_SUPERSEDED_PREFIX,
  type MediaEditFile,
  type MediaEditFileMeta,
  type MediaEditState,
  type PruneSupersededMediaEditFilesParams,
  type RevertMediaEditParams
} from '@/lib/database/domains/mediaEdit/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'
import {
  MEDIA_COLUMNS,
  type MediaRow,
  parseMediaRow,
  toMediaRowId
} from '@/lib/database/sql/media'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import type { Media } from '@/lib/types/database/operations'

const EDIT_STATE_COLUMNS = [
  'editRecipe',
  'editVersion',
  'editedAt',
  'editSaveId'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseMeta = (value: unknown): MediaEditFileMeta => {
  if (isRecord(value)) return value as MediaEditFileMeta
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? (parsed as MediaEditFileMeta) : {}
  } catch {
    return {}
  }
}

type MediaEditFileRow = {
  id: string
  mediaId: number | string
  actorId: string
  slot: string
  path: string
  bytes: number | string
  mimeType: string
  metaData: unknown
  createdAt: number
}

const toMediaEditFile = (row: MediaEditFileRow): MediaEditFile => ({
  id: row.id,
  mediaId: String(row.mediaId),
  actorId: row.actorId,
  slot: row.slot,
  path: row.path,
  bytes: Number(row.bytes),
  mimeType: row.mimeType,
  metaData: parseMeta(row.metaData),
  createdAt: Number(row.createdAt)
})

const toRowIds = (mediaIds: string[]) => [
  ...new Set(
    mediaIds.map(toMediaRowId).filter((id): id is number => id !== null)
  )
]

const selectFiles = (db: Db, mediaId: number) =>
  db
    .selectFrom('media_edit_files')
    .selectAll()
    .where('mediaId', '=', mediaId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()

export const getMediaEditState = async (
  db: Db,
  { mediaId }: GetMediaEditStateParams
): Promise<MediaEditState | null> => {
  const id = toMediaRowId(mediaId)
  if (id === null) return null

  const row = await db
    .selectFrom('medias')
    .select(EDIT_STATE_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) return null

  const files = (await selectFiles(db, id)).map(toMediaEditFile)
  return {
    version: Number(row.editVersion ?? 0),
    recipe: row.editRecipe ?? null,
    editedAt: row.editedAt === null ? null : Number(row.editedAt),
    saveId: row.editSaveId ?? null,
    original:
      files.find((file) => file.slot === MEDIA_EDIT_ORIGINAL_SLOT) ?? null,
    masks: files.filter((file) => file.slot.startsWith(MEDIA_EDIT_MASK_PREFIX))
  }
}

export const listMediaEditFiles = async (
  db: Db,
  { mediaIds }: ListMediaEditFilesParams
): Promise<MediaEditFile[]> => {
  const rows = await selectInChunks(db, toRowIds(mediaIds), (chunk) =>
    db
      .selectFrom('media_edit_files')
      .selectAll()
      .where('mediaId', 'in', chunk)
      .orderBy('mediaId', 'asc')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute()
  )
  return rows.map(toMediaEditFile)
}

/**
 * Every stored path a set of files keeps: each file, and the `original` slot's
 * `upload.clientPath` (a presigned upload's own key, which a re-PUT through the
 * still-valid URL can recreate) when it differs from the stored path.
 */
export const getMediaEditFilePathsFromFiles = (
  files: Pick<MediaEditFile, 'slot' | 'path' | 'metaData'>[]
): string[] => {
  const paths = new Set<string>()
  for (const file of files) {
    paths.add(file.path)
    const clientPath = file.metaData.upload?.clientPath
    if (
      file.slot === MEDIA_EDIT_ORIGINAL_SLOT &&
      typeof clientPath === 'string' &&
      clientPath &&
      clientPath !== file.path
    ) {
      paths.add(clientPath)
    }
  }
  return [...paths]
}

export const getMediaEditFilePaths = async (
  db: Db,
  { mediaIds }: GetMediaEditFilePathsParams
): Promise<string[]> =>
  getMediaEditFilePathsFromFiles(await listMediaEditFiles(db, { mediaIds }))

type LockedMedia = {
  row: MediaRow & {
    editVersion: number
    editSaveId: string | null
  }
  accountId: string
}

// The media row, locked FOR UPDATE on PostgreSQL (SQLite serialises write
// transactions on its one connection), when it belongs to `accountId`.
const lockOwnedMedia = async (
  trx: Db,
  mediaRowId: number,
  accountId: string
): Promise<LockedMedia | null> => {
  const row = await forUpdate(
    trx,
    trx
      .selectFrom('medias')
      .select([...MEDIA_COLUMNS, 'editSaveId'])
      .where('id', '=', mediaRowId)
  ).executeTakeFirst()
  if (!row?.actorId) return null

  const actor = await trx
    .selectFrom('actors')
    .select('accountId')
    .where('id', '=', row.actorId)
    .executeTakeFirst()
  if (!actor?.accountId || actor.accountId !== accountId) return null

  return {
    row: row as unknown as LockedMedia['row'],
    accountId: actor.accountId
  }
}

const readMedia = async (trx: Db, mediaRowId: number): Promise<Media> => {
  const row = await trx
    .selectFrom('medias')
    .select(MEDIA_COLUMNS)
    .where('id', '=', mediaRowId)
    .executeTakeFirstOrThrow()
  return parseMediaRow(row as unknown as MediaRow)
}

// Bumps the version only when it still is `baseVersion`. The row lock already
// serialises writers on PostgreSQL; the guard is what keeps a write whose
// version check read a value that has since moved from landing anyway.
const guardedUpdate = async (
  trx: Db,
  mediaRowId: number,
  baseVersion: number,
  values: Record<string, unknown>
): Promise<boolean> => {
  const result = await trx
    .updateTable('medias')
    .set({ ...values, editVersion: baseVersion + 1 })
    .where('id', '=', mediaRowId)
    .where('editVersion', '=', baseVersion)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

const staleResult = async (
  trx: Db,
  mediaRowId: number
): Promise<ApplyMediaEditResult> => {
  const current = await trx
    .selectFrom('medias')
    .select(['editVersion', 'editSaveId'])
    .where('id', '=', mediaRowId)
    .executeTakeFirst()
  return {
    status: 'stale',
    version: Number(current?.editVersion ?? 0),
    saveId: current?.editSaveId ?? null
  }
}

const parseRowMeta = (row: MediaRow) => parseMeta(row.originalMetaData)

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const getRowFocus = (row: MediaRow) => {
  const x = toNumberOrNull(row.focusX)
  const y = toNumberOrNull(row.focusY)
  return x === null || y === null ? null : { x, y }
}

const insertFile = (
  trx: Db,
  file: Omit<MediaEditFile, 'id' | 'createdAt' | 'mediaId'> & {
    mediaId: number
  },
  createdAt: Date
) =>
  trx
    .insertInto('media_edit_files')
    .values({
      id: crypto.randomUUID(),
      mediaId: file.mediaId,
      actorId: file.actorId,
      slot: file.slot,
      path: file.path,
      bytes: file.bytes,
      mimeType: file.mimeType,
      metaData: JSON.stringify(file.metaData),
      createdAt
    })
    .execute()

// The live file of the row as a superseded render, kept for the posts that
// may still show it until it is pruned.
const supersedeLiveFile = (
  trx: Db,
  mediaRowId: number,
  row: MediaRow,
  createdAt: Date
) => {
  const meta = parseRowMeta(row)
  return insertFile(
    trx,
    {
      mediaId: mediaRowId,
      actorId: row.actorId,
      slot: `${MEDIA_EDIT_SUPERSEDED_PREFIX}${crypto.randomUUID()}`,
      path: row.original,
      bytes: Number(row.originalBytes ?? 0),
      mimeType: row.originalMimeType,
      metaData: {
        width: Number(meta.width ?? 0),
        height: Number(meta.height ?? 0)
      }
    },
    createdAt
  )
}

/**
 * Saves a render of a recipe as the media's live file, in one transaction:
 * the first save moves the uploaded file into the `original` slot, a later one
 * keeps the previous render as a `superseded:*` slot. The account's media
 * usage grows by the render's bytes (nothing is freed: the old file is kept).
 */
export const applyMediaEdit = async (
  db: Db,
  {
    mediaId,
    accountId,
    baseVersion,
    saveId,
    recipe,
    render
  }: ApplyMediaEditParams
): Promise<ApplyMediaEditResult> => {
  const mediaRowId = toMediaRowId(mediaId)
  if (mediaRowId === null) return { status: 'not-found' }

  return inTransaction(db, async (trx) => {
    const locked = await lockOwnedMedia(trx, mediaRowId, accountId)
    if (!locked) return { status: 'not-found' }
    const { row } = locked
    if (Number(row.editVersion) !== baseVersion) {
      return {
        status: 'stale',
        version: Number(row.editVersion),
        saveId: row.editSaveId ?? null
      }
    }

    const now = new Date()
    const updated = await guardedUpdate(trx, mediaRowId, baseVersion, {
      original: render.path,
      originalBytes: render.bytes,
      originalMimeType: render.mimeType,
      originalMetaData: JSON.stringify({
        width: render.width,
        height: render.height
      }),
      blurhash: render.blurhash,
      focusX: render.focus?.x ?? null,
      focusY: render.focus?.y ?? null,
      editRecipe: recipe,
      editedAt: now,
      editSaveId: saveId,
      updatedAt: now
    })
    if (!updated) return staleResult(trx, mediaRowId)

    const existingOriginal = await trx
      .selectFrom('media_edit_files')
      .select('id')
      .where('mediaId', '=', mediaRowId)
      .where('slot', '=', MEDIA_EDIT_ORIGINAL_SLOT)
      .executeTakeFirst()
    if (existingOriginal) {
      await supersedeLiveFile(trx, mediaRowId, row, now)
    } else {
      await insertFile(
        trx,
        {
          mediaId: mediaRowId,
          actorId: row.actorId,
          slot: MEDIA_EDIT_ORIGINAL_SLOT,
          path: row.original,
          bytes: Number(row.originalBytes ?? 0),
          mimeType: row.originalMimeType,
          metaData: {
            ...parseRowMeta(row),
            blurhash: row.blurhash ?? null,
            focus: getRowFocus(row)
          }
        },
        now
      )
    }

    if (render.bytes > 0) {
      await increaseCounterValue(
        trx,
        CounterKey.mediaUsage(accountId),
        render.bytes,
        now
      )
      await incrementBucket(trx, 'media-bytes', render.bytes, now)
    }

    return {
      status: 'ok',
      media: await readMedia(trx, mediaRowId),
      version: baseVersion + 1,
      removedPaths: []
    }
  })
}

/**
 * Puts the uploaded file back as the live one and forgets the recipe. The
 * render it replaces is kept as a superseded slot (a post may still show it),
 * and mask files are removed: their bytes leave the usage counter and their
 * paths are returned for deletion after the commit.
 */
export const revertMediaEdit = async (
  db: Db,
  { mediaId, accountId, baseVersion, saveId }: RevertMediaEditParams
): Promise<ApplyMediaEditResult> => {
  const mediaRowId = toMediaRowId(mediaId)
  if (mediaRowId === null) return { status: 'not-found' }

  return inTransaction(db, async (trx) => {
    const locked = await lockOwnedMedia(trx, mediaRowId, accountId)
    if (!locked) return { status: 'not-found' }
    const { row } = locked
    if (Number(row.editVersion) !== baseVersion) {
      return {
        status: 'stale',
        version: Number(row.editVersion),
        saveId: row.editSaveId ?? null
      }
    }

    const files = (await selectFiles(trx, mediaRowId)).map(toMediaEditFile)
    const original = files.find(
      (file) => file.slot === MEDIA_EDIT_ORIGINAL_SLOT
    )
    if (!original) return { status: 'not-edited' }

    const { blurhash, focus, ...originalMeta } = original.metaData
    const now = new Date()
    const updated = await guardedUpdate(trx, mediaRowId, baseVersion, {
      original: original.path,
      originalBytes: original.bytes,
      originalMimeType: original.mimeType,
      originalMetaData: JSON.stringify(originalMeta),
      blurhash: typeof blurhash === 'string' ? blurhash : null,
      focusX: focus?.x ?? null,
      focusY: focus?.y ?? null,
      editRecipe: null,
      editedAt: null,
      editSaveId: saveId,
      updatedAt: now
    })
    if (!updated) return staleResult(trx, mediaRowId)

    await supersedeLiveFile(trx, mediaRowId, row, now)
    const masks = files.filter((file) =>
      file.slot.startsWith(MEDIA_EDIT_MASK_PREFIX)
    )
    const removedIds = [original.id, ...masks.map((mask) => mask.id)]
    await trx
      .deleteFrom('media_edit_files')
      .where('mediaId', '=', mediaRowId)
      .where('id', 'in', removedIds)
      .execute()

    const maskBytes = masks.reduce((sum, mask) => sum + mask.bytes, 0)
    if (maskBytes > 0) {
      await decreaseCounterValue(
        trx,
        CounterKey.mediaUsage(accountId),
        maskBytes,
        now
      )
    }

    return {
      status: 'ok',
      media: await readMedia(trx, mediaRowId),
      version: baseVersion + 1,
      removedPaths: getMediaEditFilePathsFromFiles(masks)
    }
  })
}

/**
 * Removes every superseded render of the media and frees its bytes from the
 * account's media usage. Returns the paths, which the caller deletes after
 * the commit. The hourly `media-bytes` bucket is increment-only (it counts
 * stored bytes per hour, like every other bucket), so it is left alone.
 *
 * Only the write that is still the media's latest may prune, checked under the
 * row lock: once another save or revert has committed, the render this write
 * made is itself superseded and that write's posts may still show it (a
 * "Gallery only" save keeps it for them; an "Update posts" one may not have
 * reached them yet). The later write prunes when its own posts are done.
 */
export const pruneSupersededMediaEditFiles = async (
  db: Db,
  { mediaId, accountId, version }: PruneSupersededMediaEditFilesParams
): Promise<string[]> => {
  const mediaRowId = toMediaRowId(mediaId)
  if (mediaRowId === null) return []

  return inTransaction(db, async (trx) => {
    const locked = await lockOwnedMedia(trx, mediaRowId, accountId)
    if (!locked) return []
    if (Number(locked.row.editVersion) !== version) return []

    const superseded = (await selectFiles(trx, mediaRowId))
      .map(toMediaEditFile)
      .filter((file) => file.slot.startsWith(MEDIA_EDIT_SUPERSEDED_PREFIX))
    if (superseded.length === 0) return []

    await trx
      .deleteFrom('media_edit_files')
      .where('mediaId', '=', mediaRowId)
      .where(
        'id',
        'in',
        superseded.map((file) => file.id)
      )
      .execute()

    const bytes = superseded.reduce((sum, file) => sum + file.bytes, 0)
    if (bytes > 0) {
      await decreaseCounterValue(trx, CounterKey.mediaUsage(accountId), bytes)
    }
    return superseded.map((file) => file.path)
  })
}

export const mediaEditQueries = {
  getMediaEditState,
  listMediaEditFiles,
  getMediaEditFilePaths,
  applyMediaEdit,
  revertMediaEdit,
  pruneSupersededMediaEditFiles
}
