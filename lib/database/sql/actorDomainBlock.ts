import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  ActorDomainBlockDatabase,
  CreateActorDomainBlockParams,
  DeleteActorDomainBlockParams,
  GetActorDomainBlocksParams,
  IsDomainBlockedByActorParams
} from '@/lib/types/database/operations'
import { ActorDomainBlock } from '@/lib/types/domain/actorDomainBlock'

const fixActorDomainBlockDataDate = (
  data: ActorDomainBlock
): ActorDomainBlock => ({
  ...data,
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt)
})

const applyCursor = (
  query: Knex.QueryBuilder,
  cursor: ActorDomainBlock,
  direction: 'newer' | 'older'
) => {
  const operator = direction === 'older' ? '<' : '>'

  query.andWhere((builder) => {
    builder
      .where('createdAt', operator, cursor.createdAt)
      .orWhere((tieBreaker) => {
        tieBreaker
          .where('createdAt', cursor.createdAt)
          .andWhere('id', operator, cursor.id)
      })
  })
}

export const ActorDomainBlockSQLDatabaseMixin = (
  database: Knex
): ActorDomainBlockDatabase => ({
  async createActorDomainBlock({
    actorId,
    domain
  }: CreateActorDomainBlockParams) {
    const existing = await database<ActorDomainBlock>('actor_domain_blocks')
      .where({ actorId, domain })
      .first()
    if (existing) return fixActorDomainBlockDataDate(existing)

    const currentTime = new Date()
    const block: ActorDomainBlock = {
      id: randomUUID(),
      actorId,
      domain,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }

    try {
      await database('actor_domain_blocks').insert({
        ...block,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      return block
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error

      // Race: another request inserted between our SELECT and INSERT.
      const duplicated = await database<ActorDomainBlock>('actor_domain_blocks')
        .where({ actorId, domain })
        .first()
      if (duplicated) return fixActorDomainBlockDataDate(duplicated)
      throw error
    }
  },

  async deleteActorDomainBlock({
    actorId,
    domain
  }: DeleteActorDomainBlockParams) {
    const existing = await database<ActorDomainBlock>('actor_domain_blocks')
      .where({ actorId, domain })
      .first()
    if (!existing) return null

    await database('actor_domain_blocks').where('id', existing.id).delete()
    return fixActorDomainBlockDataDate(existing)
  },

  async isDomainBlockedByActor({
    actorId,
    domain
  }: IsDomainBlockedByActorParams) {
    const block = await database('actor_domain_blocks')
      .where({ actorId, domain })
      .first('id')
    return Boolean(block)
  },

  async getActorDomainBlocks({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetActorDomainBlocksParams) {
    const query = database<ActorDomainBlock>('actor_domain_blocks').where(
      'actorId',
      actorId
    )
    if (limit !== undefined) query.limit(limit)

    const cursorId = maxId || minId || sinceId
    if (cursorId) {
      const cursor = await database<ActorDomainBlock>('actor_domain_blocks')
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
    return (minId ? blocks.reverse() : blocks).map(fixActorDomainBlockDataDate)
  }
})
