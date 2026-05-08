import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  BlockDatabase,
  CreateBlockParams,
  DeleteBlockByUriParams,
  DeleteBlockParams,
  GetBlockByUriParams,
  GetBlockParams,
  GetBlocksParams,
  IsBlockingParams,
  IsEitherBlockingParams
} from '@/lib/types/database/operations'
import { Block } from '@/lib/types/domain/block'

const fixBlockDataDate = (data: Block): Block => ({
  ...data,
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt)
})

const isUniqueConstraintError = (error: unknown) => {
  const { code, errno, message } = error as {
    code?: string
    errno?: number
    message?: string
  }
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errno === 1062 ||
    Boolean(message?.includes('UNIQUE constraint failed'))
  )
}

export const BlockSQLDatabaseMixin = (database: Knex): BlockDatabase => ({
  async createBlock({ actorId, targetActorId, uri }: CreateBlockParams) {
    const existingBlock = await this.getBlock({ actorId, targetActorId })
    if (existingBlock) return existingBlock

    const currentTime = new Date()
    const block: Block = {
      id: crypto.randomUUID(),
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      uri,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }

    try {
      await database.transaction(async (trx) => {
        await trx('blocks').insert({
          ...block,
          createdAt: currentTime,
          updatedAt: currentTime
        })

        await Promise.all([
          increaseCounterValue(
            trx,
            CounterKey.totalBlocking(actorId),
            1,
            currentTime
          ),
          increaseCounterValue(
            trx,
            CounterKey.totalBlockedBy(targetActorId),
            1,
            currentTime
          )
        ])
      })
      return block
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error

      const duplicatedBlock =
        (await this.getBlock({ actorId, targetActorId })) ||
        (await this.getBlockByUri({ uri }))
      if (duplicatedBlock) return duplicatedBlock
      throw error
    }
  },

  async deleteBlock({ actorId, targetActorId }: DeleteBlockParams) {
    return database.transaction(async (trx) => {
      const existingBlock = await trx<Block>('blocks')
        .where({ actorId, targetActorId })
        .first()
      if (!existingBlock) return null

      const currentTime = new Date()
      await trx('blocks').where('id', existingBlock.id).delete()
      await Promise.all([
        decreaseCounterValue(
          trx,
          CounterKey.totalBlocking(actorId),
          1,
          currentTime
        ),
        decreaseCounterValue(
          trx,
          CounterKey.totalBlockedBy(targetActorId),
          1,
          currentTime
        )
      ])

      return fixBlockDataDate(existingBlock)
    })
  },

  async deleteBlockByUri({ actorId, uri }: DeleteBlockByUriParams) {
    return database.transaction(async (trx) => {
      const existingBlock = await trx<Block>('blocks')
        .where({ actorId, uri })
        .first()
      if (!existingBlock) return null

      const currentTime = new Date()
      await trx('blocks').where('id', existingBlock.id).delete()
      await Promise.all([
        decreaseCounterValue(
          trx,
          CounterKey.totalBlocking(existingBlock.actorId),
          1,
          currentTime
        ),
        decreaseCounterValue(
          trx,
          CounterKey.totalBlockedBy(existingBlock.targetActorId),
          1,
          currentTime
        )
      ])

      return fixBlockDataDate(existingBlock)
    })
  },

  async getBlock({ actorId, targetActorId }: GetBlockParams) {
    const block = await database<Block>('blocks')
      .where({ actorId, targetActorId })
      .first()
    if (!block) return null
    return fixBlockDataDate(block)
  },

  async getBlockByUri({ uri }: GetBlockByUriParams) {
    const block = await database<Block>('blocks').where({ uri }).first()
    if (!block) return null
    return fixBlockDataDate(block)
  },

  async isBlocking({ actorId, targetActorId }: IsBlockingParams) {
    const block = await database('blocks')
      .where({ actorId, targetActorId })
      .first('id')
    return Boolean(block)
  },

  async isEitherBlocking({ actorIdA, actorIdB }: IsEitherBlockingParams) {
    const block = await database('blocks')
      .where((builder) => {
        builder
          .where({ actorId: actorIdA, targetActorId: actorIdB })
          .orWhere({ actorId: actorIdB, targetActorId: actorIdA })
      })
      .first('id')
    return Boolean(block)
  },

  async getBlocks({ actorId, limit, maxId, minId }: GetBlocksParams) {
    const query = database<Block>('blocks')
      .where('actorId', actorId)
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) query.where('id', '<', maxId)
    if (minId) query.where('id', '>', minId)

    const blocks = await query
    return (minId ? [...blocks].reverse() : blocks).map(fixBlockDataDate)
  }
})
