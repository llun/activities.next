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

import { getCompatibleJSON } from './utils/getCompatibleJSON'

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
    (errorCode === 'SQLITE_CONSTRAINT' &&
      Boolean(errorMessage?.includes('UNIQUE constraint failed'))) ||
    Boolean(errorMessage?.includes('UNIQUE constraint failed'))
  )
}

const parseStatusContent = (
  content: unknown
):
  | string
  | {
      url?: string
    }
  | null => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return getCompatibleJSON(content)
    } catch {
      return content
    }
  }
  if (typeof content === 'object') {
    return content as { url?: string }
  }
  return null
}

const getOriginalStatusIdFromAnnounceContent = (content: unknown) => {
  const parsed = parseStatusContent(content)
  if (!parsed) return null
  if (typeof parsed === 'string') return parsed
  if (typeof parsed.url === 'string' && parsed.url.length > 0) {
    return parsed.url
  }
  return null
}

const resolveBookmarkStatusId = async ({
  database,
  statusId
}: {
  database: Knex | Knex.Transaction
  statusId: string
}): Promise<string | null> => {
  const status = await database('statuses').where('id', statusId).first<{
    id: string
    type: string
    content: unknown
  }>('id', 'type', 'content')
  if (!status) return null

  if (status.type !== StatusType.enum.Announce) return status.id

  return getOriginalStatusIdFromAnnounceContent(status.content)
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
    statusId
  }: IsActorBookmarkedStatusParams) {
    const bookmarkStatusId =
      (await resolveBookmarkStatusId({ database, statusId })) ?? statusId
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

    const cursorId = maxId || minId || sinceId

    if (cursorId) {
      const cursor = await database<Bookmark>('bookmarks')
        .where({ actorId, id: cursorId })
        .first()
      if (!cursor) return []
      applyCursor(query, cursor, maxId ? 'older' : 'newer')
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
