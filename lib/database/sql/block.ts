import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  BlockDatabase,
  BlockRelation,
  CreateBlockParams,
  DeleteBlockByUriParams,
  DeleteBlockParams,
  GetBlockByUriParams,
  GetBlockParams,
  GetBlockRelationsParams,
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
  cursor: Block | undefined,
  direction: 'newer' | 'older'
) => {
  if (!cursor) {
    query.where('id', '')
    return
  }

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

export const BlockSQLDatabaseMixin = (database: Knex): BlockDatabase => ({
  async createBlock({ actorId, targetActorId, uri }: CreateBlockParams) {
    const existingBlock = await this.getBlock({ actorId, targetActorId })
    if (existingBlock) return existingBlock

    const currentTime = new Date()
    const block: Block = {
      id: randomUUID(),
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
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId || minId) {
      const cursor = await database<Block>('blocks')
        .where({ actorId, id: maxId || minId })
        .first()
      applyCursor(query, cursor, maxId ? 'older' : 'newer')
    }

    const blocks = await query
    return blocks.map(fixBlockDataDate)
  },

  async getBlockRelations({
    actorIds,
    targetActorIds
  }: GetBlockRelationsParams) {
    if (actorIds.length === 0 || targetActorIds.length === 0) return []

    return database<BlockRelation>('blocks')
      .select('actorId', 'targetActorId')
      .where((builder) => {
        builder
          .where((forward) => {
            forward
              .whereIn('actorId', actorIds)
              .whereIn('targetActorId', targetActorIds)
          })
          .orWhere((reverse) => {
            reverse
              .whereIn('actorId', targetActorIds)
              .whereIn('targetActorId', actorIds)
          })
      })
  }
})
