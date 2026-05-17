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
  sourceStatusId?: string | null
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

const isBookmarkCursorId = (id: string) => BOOKMARK_CURSOR_ID_PATTERN.test(id)

const resolveBookmarkStatusId = async ({
  database,
  statusId,
  statusType,
  depth = 0
}: {
  database: Knex | Knex.Transaction
  statusId: string
  statusType?: StatusType
  depth?: number
}): Promise<string | null> => {
  if (depth > MAX_ANNOUNCE_RESOLUTION_DEPTH) return statusId
  if (statusType && statusType !== StatusType.enum.Announce) return statusId

  const status = await database('statuses').where('id', statusId).first<{
    id: string
    type: string
    originalStatusId?: string | null
    content: unknown
  }>('id', 'type', 'originalStatusId', 'content')
  if (!status) return null

  if (status.type !== StatusType.enum.Announce) return status.id

  const originalStatusId =
    status.originalStatusId ||
    getOriginalStatusIdFromAnnounceContent(status.content)
  if (!originalStatusId || originalStatusId === status.id) return status.id

  return (
    (await resolveBookmarkStatusId({
      database,
      statusId: originalStatusId,
      depth: depth + 1
    })) ?? originalStatusId
  )
}

const applyBookmarkStatusFilter = ({
  query,
  statusId,
  bookmarkStatusId
}: {
  query: Knex.QueryBuilder
  statusId: string
  bookmarkStatusId: string | null
}) => {
  query.andWhere((builder) => {
    builder
      .where('statusId', bookmarkStatusId ?? statusId)
      .orWhere('sourceStatusId', statusId)
  })
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
          .first<BookmarkRow>('id', 'sourceStatusId')

        const currentTime = new Date()
        const sourceStatusId = statusId === bookmarkStatusId ? null : statusId
        if (existing) {
          if (sourceStatusId && existing.sourceStatusId !== sourceStatusId) {
            await trx('bookmarks').where('id', existing.id).update({
              sourceStatusId,
              updatedAt: currentTime
            })
          }
          return
        }

        await trx('bookmarks').insert({
          actorId,
          statusId: bookmarkStatusId,
          sourceStatusId,
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

      const query = trx('bookmarks').where({ actorId })
      applyBookmarkStatusFilter({ query, statusId, bookmarkStatusId })
      await query.delete()
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
    const query = database('bookmarks').where({ actorId })
    applyBookmarkStatusFilter({ query, statusId, bookmarkStatusId })
    const bookmark = await query.first('id')
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
