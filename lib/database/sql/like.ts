import { Knex } from 'knex'

import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  IsActorLikedStatusParams,
  LikeDatabase
} from '@/lib/database/types/like'

export const LikeSQLDatabaseMixin = (database: Knex): LikeDatabase => ({
  async createLike({ actorId, statusId }: CreateLikeParams) {
    const status = await database('statuses').where('id', statusId).first()
    if (!status) return

    const result = await database('likes')
      .where({ actorId, statusId })
      .count<{ count: string }>('* as count')
      .first()
    if (parseInt(result?.count ?? '0', 10) === 1) {
      return
    }

    await database('likes').insert({
      actorId,
      statusId
    })
  },

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    await database('likes').where({ actorId, statusId }).delete()
  },

  async getLikeCount({ statusId }: GetLikeCountParams) {
    const result = await database('likes')
      .where('statusId', statusId)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10)
  },

  async isActorLikedStatus({ statusId, actorId }: IsActorLikedStatusParams) {
    const result = await database('likes')
      .where('statusId', statusId)
      .where('actorId', actorId)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10) !== 0
  }
})
