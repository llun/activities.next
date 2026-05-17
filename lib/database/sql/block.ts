import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
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

const BLOCK_RELATION_LOOKUP_CHUNK_SIZE = 1000

const chunkArray = <T>(items: T[], chunkSize: number) => {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

const applyCursor = (
  query: Knex.QueryBuilder,
  cursor: Block,
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

  async getBlocks({ actorId, limit, maxId, minId, sinceId }: GetBlocksParams) {
    const query = database<Block>('blocks')
      .where('actorId', actorId)
      .limit(limit)

    const cursorId = maxId || minId || sinceId

    if (cursorId) {
      const cursor = await database<Block>('blocks')
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

    const blocks = await query
    return (minId ? blocks.reverse() : blocks).map(fixBlockDataDate)
  },

  async getBlockRelations({
    actorIds,
    targetActorIds
  }: GetBlockRelationsParams) {
    const uniqueActorIds = [...new Set(actorIds)]
    const uniqueTargetActorIds = [...new Set(targetActorIds)]

    if (uniqueActorIds.length === 0 || uniqueTargetActorIds.length === 0) {
      return []
    }

    const relationsByKey = new Map<string, BlockRelation>()
    const actorIdChunks = chunkArray(
      uniqueActorIds,
      BLOCK_RELATION_LOOKUP_CHUNK_SIZE
    )
    const targetActorIdChunks = chunkArray(
      uniqueTargetActorIds,
      BLOCK_RELATION_LOOKUP_CHUNK_SIZE
    )

    const relationGroups = await Promise.all(
      actorIdChunks.flatMap((actorIdChunk) =>
        targetActorIdChunks.map((targetActorIdChunk) =>
          database<BlockRelation>('blocks')
            .select('actorId', 'targetActorId')
            .where((builder) => {
              builder
                .where((forward) => {
                  forward
                    .whereIn('actorId', actorIdChunk)
                    .whereIn('targetActorId', targetActorIdChunk)
                })
                .orWhere((reverse) => {
                  reverse
                    .whereIn('actorId', targetActorIdChunk)
                    .whereIn('targetActorId', actorIdChunk)
                })
            })
        )
      )
    )

    for (const relations of relationGroups) {
      for (const relation of relations) {
        relationsByKey.set(
          JSON.stringify([relation.actorId, relation.targetActorId]),
          relation
        )
      }
    }

    return [...relationsByKey.values()]
  }
})
