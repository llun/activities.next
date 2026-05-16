import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  BookmarkDatabase,
  CreateBookmarkParams,
  DeleteBookmarkParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams
} from '@/lib/types/database/operations'
import { Bookmark } from '@/lib/types/domain/bookmark'

const fixBookmarkDataDate = (data: Bookmark): Bookmark => ({
  ...data,
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
    (errorCode === 'SQLITE_CONSTRAINT' &&
      Boolean(errorMessage?.includes('UNIQUE constraint failed')))
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
    const currentTime = new Date()

    try {
      await database.transaction(async (trx) => {
        const status = await trx('statuses').where('id', statusId).first('id')
        if (!status) return

        const existing = await trx('bookmarks')
          .where({ actorId, statusId })
          .first('id')
        if (existing) return

        await trx('bookmarks').insert({
          id: randomUUID(),
          actorId,
          statusId,
          createdAt: currentTime,
          updatedAt: currentTime
        })
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  },

  async deleteBookmark({ actorId, statusId }: DeleteBookmarkParams) {
    await database('bookmarks').where({ actorId, statusId }).delete()
  },

  async isActorBookmarkedStatus({
    actorId,
    statusId
  }: IsActorBookmarkedStatusParams) {
    const result = await database('bookmarks')
      .where({ actorId, statusId })
      .first('id')
    return Boolean(result)
  },

  async getBookmarks({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetBookmarksParams) {
    const query = database<Bookmark>('bookmarks')
      .where({ actorId })
      .limit(limit)
    const cursorId = maxId || minId || sinceId

    if (cursorId) {
      const cursor = await database<Bookmark>('bookmarks')
        .where({ actorId, id: cursorId })
        .first()
      if (!cursor) return []
      applyCursor(query, cursor, maxId ? 'older' : 'newer')
    }

    if (minId || sinceId) {
      query.orderBy('createdAt', 'asc').orderBy('id', 'asc')
    } else {
      query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    }

    const bookmarks = await query
    return (minId || sinceId ? bookmarks.reverse() : bookmarks).map(
      fixBookmarkDataDate
    )
  }
})
