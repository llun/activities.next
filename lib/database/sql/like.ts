import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { decodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  GetLikesParams,
  IsActorLikedStatusParams,
  Like,
  LikeDatabase
} from '@/lib/types/database/operations'

type LikeRow = {
  actorId: string
  statusId: string
  createdAt: number | Date | string
}

const applyFavouriteCursor = (
  query: Knex.QueryBuilder,
  cursor: { createdAt: number; statusId: string },
  direction: 'newer' | 'older'
) => {
  const operator = direction === 'older' ? '<' : '>'
  const createdAtValue = new Date(cursor.createdAt)
  query.andWhere((builder) => {
    builder
      .where('createdAt', operator, createdAtValue)
      .orWhere((tieBreaker) => {
        tieBreaker
          .where('createdAt', createdAtValue)
          .andWhere('statusId', operator, cursor.statusId)
      })
  })
}

export const LikeSQLDatabaseMixin = (database: Knex): LikeDatabase => ({
  async createLike({ actorId, statusId }: CreateLikeParams) {
    await database.transaction(async (trx) => {
      const status = await trx('statuses').where('id', statusId).first('id')
      if (!status) return

      const existing = await trx('likes').where({ actorId, statusId }).first()
      if (existing) {
        return
      }

      const currentTime = new Date()
      await trx('likes').insert({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await increaseCounterValue(
        trx,
        CounterKey.totalLike(statusId),
        1,
        currentTime
      )
    })
  },

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    await database.transaction(async (trx) => {
      const deleted = await trx('likes').where({ actorId, statusId }).delete()
      if (!deleted) return

      const currentTime = new Date()
      await decreaseCounterValue(
        trx,
        CounterKey.totalLike(statusId),
        deleted,
        currentTime
      )
    })
  },

  async getLikeCount({ statusId }: GetLikeCountParams) {
    return getCounterValue(database, CounterKey.totalLike(statusId))
  },

  async isActorLikedStatus({ statusId, actorId }: IsActorLikedStatusParams) {
    const result = await database('likes')
      .where('statusId', statusId)
      .where('actorId', actorId)
      .first()
    return Boolean(result)
  },

  async getLikes({ actorId, limit, maxId, minId, sinceId }: GetLikesParams) {
    const olderCursorToken = maxId
    const newerCursorToken = minId || sinceId

    // Reject malformed cursors with an empty page instead of scanning from the
    // top, matching the bookmarks pagination contract.
    if (
      (olderCursorToken && !decodeFavouriteCursor(olderCursorToken)) ||
      (newerCursorToken && !decodeFavouriteCursor(newerCursorToken))
    ) {
      return []
    }

    const query = database<LikeRow>('likes')
      .where('actorId', actorId)
      .limit(limit)

    const olderCursor = decodeFavouriteCursor(olderCursorToken)
    if (olderCursor) applyFavouriteCursor(query, olderCursor, 'older')

    const newerCursor = decodeFavouriteCursor(newerCursorToken)
    if (newerCursor) applyFavouriteCursor(query, newerCursor, 'newer')

    if (minId) {
      query.orderBy('createdAt', 'asc').orderBy('statusId', 'asc')
    } else {
      query.orderBy('createdAt', 'desc').orderBy('statusId', 'desc')
    }

    const rows = await query
    const ordered = minId ? rows.reverse() : rows
    return ordered.map((row): Like => ({
      actorId: row.actorId,
      statusId: row.statusId,
      createdAt: getCompatibleTime(row.createdAt)
    }))
  }
})
