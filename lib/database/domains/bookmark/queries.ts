import type { ExpressionBuilder } from 'kysely'

import type {
  BookmarkFolderWriteResult,
  CreateBookmarkFolderParams,
  CreateBookmarkParams,
  DeleteBookmarkFolderParams,
  DeleteBookmarkParams,
  FileBookmarkParams,
  FileBookmarkResult,
  GetBookmarkFolderParams,
  GetBookmarkFoldersParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams,
  UpdateBookmarkFolderParams
} from '@/lib/database/domains/bookmark/types'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import type { BookmarkFolders } from '@/lib/database/kysely/db'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import {
  Bookmark,
  BookmarkFolder,
  MAX_BOOKMARK_FOLDERS_PER_ACTOR,
  MAX_BOOKMARK_FOLDER_NAME_LENGTH
} from '@/lib/types/domain/bookmark'
import { StatusType } from '@/lib/types/domain/status'
import { generatePublicId } from '@/lib/utils/publicId'

export const getOriginalStatusIdFromAnnounceContent = (content: unknown) => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'string') return parsed
      if (parsed && typeof parsed.url === 'string') return parsed.url
      if (parsed && typeof parsed.id === 'string') return parsed.id
      return null
    } catch {
      return content
    }
  }
  if (typeof content === 'object') {
    if ('url' in content && typeof content.url === 'string') return content.url
    if ('id' in content && typeof content.id === 'string') return content.id
  }
  return null
}

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10
const BOOKMARK_CURSOR_ID_PATTERN = /^\d+$/

// Bookmark ids are bigints read back as safe integers, so a longer digit string
// names no bookmark (and PostgreSQL rejects one past the int8 range).
const isBookmarkCursorId = (id: string) =>
  BOOKMARK_CURSOR_ID_PATTERN.test(id) && Number.isSafeInteger(Number(id))

const resolveBookmarkStatusId = async (
  db: Db,
  {
    statusId,
    statusType,
    depth = 0
  }: {
    statusId: string
    statusType?: StatusType
    depth?: number
  }
): Promise<string | null> => {
  if (depth > MAX_ANNOUNCE_RESOLUTION_DEPTH) return statusId
  if (statusType && statusType !== StatusType.enum.Announce) return statusId

  const status = await db
    .selectFrom('statuses')
    .select(['id', 'type', 'originalStatusId', 'content'])
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  if (!status) return null

  if (status.type !== StatusType.enum.Announce) return status.id

  const originalStatusId =
    status.originalStatusId ||
    getOriginalStatusIdFromAnnounceContent(status.content)
  if (!originalStatusId || originalStatusId === status.id) return status.id

  return (
    (await resolveBookmarkStatusId(db, {
      statusId: originalStatusId,
      depth: depth + 1
    })) ?? originalStatusId
  )
}

// A bookmark matches a status by the (announce-resolved) status it stores or by
// the status it was originally created through.
const matchesBookmarkStatus = (
  eb: ExpressionBuilder<DB, 'bookmarks'>,
  { statusId, bookmarkStatusId }: { statusId: string; bookmarkStatusId: string }
) =>
  eb.or([
    eb('statusId', '=', bookmarkStatusId),
    eb('sourceStatusId', '=', statusId)
  ])

// Writes the bookmark inside the caller's transaction: a fresh row, or the
// existing one updated. `folderId` undefined keeps the stored folder (a plain
// bookmark never unfiles), null unfiles and a string files. False when the
// status is not stored.
const writeBookmark = async (
  trx: Db,
  { actorId, statusId }: CreateBookmarkParams,
  folderId?: string | null
): Promise<boolean> => {
  const bookmarkStatusId = await resolveBookmarkStatusId(trx, { statusId })
  if (!bookmarkStatusId) return false

  const existing = await trx
    .selectFrom('bookmarks')
    .select(['id', 'sourceStatusId', 'folderId'])
    .where('actorId', '=', actorId)
    .where('statusId', '=', bookmarkStatusId)
    .limit(1)
    .executeTakeFirst()

  const currentTime = new Date()
  const sourceStatusId = statusId === bookmarkStatusId ? null : statusId
  if (existing) {
    const changes = {
      ...(sourceStatusId && existing.sourceStatusId !== sourceStatusId
        ? { sourceStatusId }
        : {}),
      ...(folderId !== undefined && (existing.folderId ?? null) !== folderId
        ? { folderId }
        : {})
    }
    if (Object.keys(changes).length > 0) {
      await trx
        .updateTable('bookmarks')
        .set({ ...changes, updatedAt: currentTime })
        .where('id', '=', existing.id)
        .execute()
    }
    return true
  }

  // A concurrent request may have inserted the same bookmark since the
  // read: that one wins, and bookmarking stays idempotent. Filing still
  // applies its folder to the winner.
  await trx
    .insertInto('bookmarks')
    .values({
      actorId,
      statusId: bookmarkStatusId,
      sourceStatusId,
      folderId: folderId ?? null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((oc) =>
      folderId === undefined
        ? oc.columns(['actorId', 'statusId']).doNothing()
        : oc
            .columns(['actorId', 'statusId'])
            .doUpdateSet({ folderId, updatedAt: currentTime })
    )
    .execute()
  return true
}

export const createBookmark = async (
  db: Db,
  params: CreateBookmarkParams
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    await writeBookmark(trx, params)
  })
}

// Serialises one actor's folder writes and filings on their actor row, the
// pattern of the gear cap (`createGalleryGearWithinLimit`), so a folder cannot
// be deleted between a filing's check and its write, and two creates cannot
// both pass the cap or the name check. SQLite's single writer already
// serialises transactions.
const lockActor = async (db: Db, actorId: string) => {
  await forUpdate(
    db,
    db.selectFrom('actors').select('id').where('id', '=', actorId)
  ).execute()
}

export const fileBookmark = (
  db: Db,
  { actorId, statusId, folderId }: FileBookmarkParams
): Promise<FileBookmarkResult> =>
  inTransaction(db, async (trx) => {
    if (folderId !== null) {
      await lockActor(trx, actorId)
      if (!(await readFolder(trx, { id: folderId, actorId }))) {
        return 'folder-not-found'
      }
    }
    return (await writeBookmark(trx, { actorId, statusId }, folderId))
      ? 'filed'
      : 'status-not-found'
  })

export const deleteBookmark = (
  db: Db,
  { actorId, statusId }: DeleteBookmarkParams
): Promise<void> =>
  inTransaction(db, async (trx) => {
    const bookmarkStatusId =
      (await resolveBookmarkStatusId(trx, { statusId })) ?? statusId
    await trx
      .deleteFrom('bookmarks')
      .where('actorId', '=', actorId)
      .where((eb) => matchesBookmarkStatus(eb, { statusId, bookmarkStatusId }))
      .execute()
  })

// The viewer's bookmark of a status, with the folder it is filed in; null when
// the status is not bookmarked.
export const getActorBookmark = async (
  db: Db,
  { actorId, statusId, statusType }: IsActorBookmarkedStatusParams
): Promise<{ folderId: string | null } | null> => {
  const bookmarkStatusId =
    (await resolveBookmarkStatusId(db, { statusId, statusType })) ?? statusId
  const bookmark = await db
    .selectFrom('bookmarks')
    .select('folderId')
    .where('actorId', '=', actorId)
    .where((eb) => matchesBookmarkStatus(eb, { statusId, bookmarkStatusId }))
    .limit(1)
    .executeTakeFirst()
  return bookmark ? { folderId: bookmark.folderId ?? null } : null
}

export const isActorBookmarkedStatus = async (
  db: Db,
  params: IsActorBookmarkedStatusParams
): Promise<boolean> => Boolean(await getActorBookmark(db, params))

export const getBookmarks = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId, folderId }: GetBookmarksParams
): Promise<Bookmark[]> => {
  const olderCursorId = maxId
  const newerCursorId = minId || sinceId

  if (
    (olderCursorId && !isBookmarkCursorId(olderCursorId)) ||
    (newerCursorId && !isBookmarkCursorId(newerCursorId))
  )
    return []

  let query = db
    .selectFrom('bookmarks')
    .selectAll()
    .where('actorId', '=', actorId)
  // The cursor below is looked up by id alone, so a cursor from another
  // folder still pages this one from that point.
  if (folderId === null) query = query.where('folderId', 'is', null)
  else if (folderId !== undefined)
    query = query.where('folderId', '=', folderId)

  for (const [cursorId, operator] of [
    [olderCursorId, '<'],
    [newerCursorId, '>']
  ] as const) {
    if (!cursorId) continue
    const cursor = await db
      .selectFrom('bookmarks')
      .select(['id', 'createdAt'])
      .where('actorId', '=', actorId)
      .where('id', '=', Number(cursorId))
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt: cursor.createdAt ?? 0, tieBreaker: cursor.id },
        operator,
        'id'
      )
    )
  }

  const direction = minId ? 'asc' : 'desc'
  const bookmarks = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .limit(limit)
    .execute()
  return (minId ? bookmarks.reverse() : bookmarks).map((row) =>
    // Parsing keeps sourceStatusId (null when the bookmark was not made through a boost) and turns the integer id into a string.
    Bookmark.parse({ ...row, id: String(row.id) })
  )
}

const parseFolder = (
  row: Pick<BookmarkFolders, 'id' | 'actorId' | 'name'> & {
    createdAt: number | Date | string
    updatedAt: number | Date | string
  }
): BookmarkFolder =>
  BookmarkFolder.parse({
    id: row.id,
    actorId: row.actorId,
    name: row.name,
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  })

const FOLDER_COLUMNS = [
  'id',
  'actorId',
  'name',
  'createdAt',
  'updatedAt'
] as const

const readFolder = async (
  db: Db,
  { id, actorId }: GetBookmarkFolderParams
): Promise<BookmarkFolder | null> => {
  const row = await db
    .selectFrom('bookmark_folders')
    .select(FOLDER_COLUMNS)
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return row ? parseFolder(row) : null
}

// Names compare case-insensitively, in JS rather than SQL, so SQLite (whose
// lower() folds ASCII only) and PostgreSQL agree on what is a duplicate.
const folderNameKey = (name: string) => name.toLowerCase()

const normalizeFolderName = (name: string): string | null => {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_BOOKMARK_FOLDER_NAME_LENGTH
    ? trimmed
    : null
}

const readFolders = async (db: Db, actorId: string) => {
  const rows = await db
    .selectFrom('bookmark_folders')
    .select(FOLDER_COLUMNS)
    .where('actorId', '=', actorId)
    .execute()
  return rows.map(parseFolder)
}

/** The actor's folders by name, case-insensitively (ties by id). */
export const getBookmarkFolders = async (
  db: Db,
  { actorId }: GetBookmarkFoldersParams
): Promise<BookmarkFolder[]> =>
  (await readFolders(db, actorId)).sort((a, b) => {
    const left = folderNameKey(a.name)
    const right = folderNameKey(b.name)
    if (left !== right) return left < right ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

export const getBookmarkFolder = (
  db: Db,
  params: GetBookmarkFolderParams
): Promise<BookmarkFolder | null> => readFolder(db, params)

export const createBookmarkFolder = (
  db: Db,
  { actorId, name }: CreateBookmarkFolderParams
): Promise<BookmarkFolderWriteResult> =>
  inTransaction(db, async (trx): Promise<BookmarkFolderWriteResult> => {
    const normalized = normalizeFolderName(name)
    if (!normalized) return { status: 'invalid-name' }
    await lockActor(trx, actorId)
    const folders = await readFolders(trx, actorId)
    if (
      folders.some(
        (folder) => folderNameKey(folder.name) === folderNameKey(normalized)
      )
    ) {
      return { status: 'duplicate-name' }
    }
    if (folders.length >= MAX_BOOKMARK_FOLDERS_PER_ACTOR) {
      return { status: 'limit-reached' }
    }
    const currentTime = new Date()
    const id = generatePublicId(currentTime.getTime())
    await trx
      .insertInto('bookmark_folders')
      .values({
        id,
        actorId,
        name: normalized,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .execute()
    const folder = await readFolder(trx, { id, actorId })
    if (!folder) throw new Error('The new bookmark folder was not stored')
    return { status: 'ok', folder }
  })

export const updateBookmarkFolder = (
  db: Db,
  { id, actorId, name }: UpdateBookmarkFolderParams
): Promise<BookmarkFolderWriteResult> =>
  inTransaction(db, async (trx): Promise<BookmarkFolderWriteResult> => {
    const normalized = normalizeFolderName(name)
    if (!normalized) return { status: 'invalid-name' }
    await lockActor(trx, actorId)
    const folders = await readFolders(trx, actorId)
    const existing = folders.find((folder) => folder.id === id)
    if (!existing) return { status: 'not-found' }
    if (
      folders.some(
        (folder) =>
          folder.id !== id &&
          folderNameKey(folder.name) === folderNameKey(normalized)
      )
    ) {
      return { status: 'duplicate-name' }
    }
    if (existing.name !== normalized) {
      await trx
        .updateTable('bookmark_folders')
        .set({ name: normalized, updatedAt: new Date() })
        .where('id', '=', id)
        .where('actorId', '=', actorId)
        .execute()
    }
    const folder = await readFolder(trx, { id, actorId })
    return folder ? { status: 'ok', folder } : { status: 'not-found' }
  })

/** Deletes the folder and keeps its bookmarks, unfiled. False when not the actor's. */
export const deleteBookmarkFolder = (
  db: Db,
  { id, actorId }: DeleteBookmarkFolderParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    await lockActor(trx, actorId)
    if (!(await readFolder(trx, { id, actorId }))) return false
    await trx
      .updateTable('bookmarks')
      .set({ folderId: null, updatedAt: new Date() })
      .where('actorId', '=', actorId)
      .where('folderId', '=', id)
      .execute()
    await trx
      .deleteFrom('bookmark_folders')
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .execute()
    return true
  })

// The facade getSQLDatabase binds with bindDb().
export const bookmarkQueries = {
  createBookmark,
  deleteBookmark,
  isActorBookmarkedStatus,
  getBookmarks,
  fileBookmark,
  getBookmarkFolders,
  getBookmarkFolder,
  createBookmarkFolder,
  updateBookmarkFolder,
  deleteBookmarkFolder
}
