import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  IsActorLikedStatusParams,
  LikeDatabase
} from '@/lib/types/database/operations'

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
  }
})
