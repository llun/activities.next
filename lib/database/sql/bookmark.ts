import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  BookmarkDatabase,
  CreateBookmarkParams,
  DeleteBookmarkParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams
} from '@/lib/types/database/operations'
import { Bookmark } from '@/lib/types/domain/bookmark'
import { StatusType } from '@/lib/types/domain/status'

type BookmarkRow = Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & {
  id: string | number
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const fixBookmarkDataDate = (data: BookmarkRow): Bookmark =>
  Bookmark.parse({
    ...data,
    id: String(data.id),
    createdAt: getCompatibleTime(data.createdAt),
    updatedAt: getCompatibleTime(data.updatedAt)
  })

const getOriginalStatusIdFromAnnounceContent = (content: unknown) => {
  if (typeof content === 'string' && content.length > 0) return content
  return null
}

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10
const BOOKMARK_CURSOR_ID_PATTERN = /^\d+$/

const isBookmarkCursorId = (id: string) => BOOKMARK_CURSOR_ID_PATTERN.test(id)

const resolveBookmarkStatusId = async ({
  database,
  statusId,
  statusType,
  depth = 0
}: {
  database: Knex | Knex.Transaction
  statusId: string
  statusType?: string
  depth?: number
}): Promise<string | null> => {
  if (depth > MAX_ANNOUNCE_RESOLUTION_DEPTH) return statusId
  if (statusType && statusType !== StatusType.enum.Announce) return statusId

  const status = await database('statuses').where('id', statusId).first<{
    id: string
    type: string
    content: unknown
  }>('id', 'type', 'content')
  if (!status) return null

  if (status.type !== StatusType.enum.Announce) return status.id

  const originalStatusId = getOriginalStatusIdFromAnnounceContent(
    status.content
  )
  if (!originalStatusId || originalStatusId === status.id) return status.id

  return (
    (await resolveBookmarkStatusId({
      database,
      statusId: originalStatusId,
      depth: depth + 1
    })) ?? originalStatusId
  )
}

const applyCursor = (
  query: Knex.QueryBuilder,
  cursor: BookmarkRow,
  direction: 'newer' | 'older'
) => {
  const createdAtOperator = direction === 'older' ? '<' : '>'
  const idOperator = direction === 'older' ? '<' : '>'

  query.andWhere((builder) => {
    builder
      .where('createdAt', createdAtOperator, cursor.createdAt)
      .orWhere((tieBreaker) => {
        tieBreaker
          .where('createdAt', cursor.createdAt)
          .andWhere('id', idOperator, cursor.id)
      })
  })
}

export const BookmarkSQLDatabaseMixin = (database: Knex): BookmarkDatabase => ({
  async createBookmark({ actorId, statusId }: CreateBookmarkParams) {
    try {
      await database.transaction(async (trx) => {
        const bookmarkStatusId = await resolveBookmarkStatusId({
          database: trx,
          statusId
        })
        if (!bookmarkStatusId) return

        const existing = await trx('bookmarks')
          .where({ actorId, statusId: bookmarkStatusId })
          .first('id')
        if (existing) return

        const currentTime = new Date()
        await trx('bookmarks').insert({
          actorId,
          statusId: bookmarkStatusId,
          createdAt: currentTime,
          updatedAt: currentTime
        })
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  },

  async deleteBookmark({ actorId, statusId }: DeleteBookmarkParams) {
    await database.transaction(async (trx) => {
      const bookmarkStatusId = await resolveBookmarkStatusId({
        database: trx,
        statusId
      })

      await trx('bookmarks')
        .where({ actorId, statusId: bookmarkStatusId ?? statusId })
        .delete()
    })
  },

  async isActorBookmarkedStatus({
    actorId,
    statusId,
    statusType
  }: IsActorBookmarkedStatusParams) {
    const bookmarkStatusId =
      (await resolveBookmarkStatusId({ database, statusId, statusType })) ??
      statusId
    const bookmark = await database('bookmarks')
      .where({ actorId, statusId: bookmarkStatusId })
      .first('id')
    return Boolean(bookmark)
  },

  async getBookmarks({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetBookmarksParams) {
    const query = database<BookmarkRow>('bookmarks')
      .where('actorId', actorId)
      .limit(limit)

    const olderCursorId = maxId
    const newerCursorId = minId || sinceId

    if (
      (olderCursorId && !isBookmarkCursorId(olderCursorId)) ||
      (newerCursorId && !isBookmarkCursorId(newerCursorId))
    )
      return []

    if (olderCursorId) {
      const cursor = await database<BookmarkRow>('bookmarks')
        .where({ actorId, id: olderCursorId })
        .first()
      if (!cursor) return []
      applyCursor(query, cursor, 'older')
    }

    if (newerCursorId) {
      const cursor = await database<BookmarkRow>('bookmarks')
        .where({ actorId, id: newerCursorId })
        .first()
      if (!cursor) return []
      applyCursor(query, cursor, 'newer')
    }

    if (minId) {
      query.orderBy('createdAt', 'asc').orderBy('id', 'asc')
    } else {
      query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    }

    const bookmarks = await query
    return (minId ? bookmarks.reverse() : bookmarks).map(fixBookmarkDataDate)
  }
})
