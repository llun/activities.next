import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  BookmarkDatabase,
  CreateBookmarkParams,
  DeleteBookmarkParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams
} from '@/lib/types/database/operations'
import { Bookmark } from '@/lib/types/domain/bookmark'
import { StatusType } from '@/lib/types/domain/status'

const fixBookmarkDataDate = (data: Bookmark): Bookmark =>
  Bookmark.parse({
    ...data,
    id: String(data.id),
    createdAt: getCompatibleTime(data.createdAt),
    updatedAt: getCompatibleTime(data.updatedAt)
  })

const isUniqueConstraintError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false

  const { code, errno, message } = error as Record<string, unknown>
  const errorCode = typeof code === 'string' ? code : undefined
  const errorNumber = typeof errno === 'number' ? errno : undefined
  const errorMessage = typeof message === 'string' ? message : undefined

  return (
    errorCode === '23505' ||
    errorCode === 'ER_DUP_ENTRY' ||
    errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errorNumber === 1062 ||
    Boolean(errorMessage?.includes('UNIQUE constraint failed'))
  )
}

const getOriginalStatusIdFromAnnounceContent = (content: unknown) => {
  if (typeof content === 'string' && content.length > 0) return content
  return null
}

const resolveBookmarkStatusId = async ({
  database,
  statusId,
  statusType
}: {
  database: Knex | Knex.Transaction
  statusId: string
  statusType?: string
}): Promise<string | null> => {
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
      statusId: originalStatusId
    })) ?? originalStatusId
  )
}

const applyCursor = (
  query: Knex.QueryBuilder,
  cursor: Bookmark,
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
    const query = database<Bookmark>('bookmarks')
      .where('actorId', actorId)
      .limit(limit)

    const olderCursorId = maxId
    const newerCursorId = minId || sinceId

    if (olderCursorId) {
      const cursor = await database<Bookmark>('bookmarks')
        .where({ actorId, id: olderCursorId })
        .first()
      if (!cursor) return []
      applyCursor(query, cursor, 'older')
    }

    if (newerCursorId) {
      const cursor = await database<Bookmark>('bookmarks')
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
