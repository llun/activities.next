import { randomUUID } from 'node:crypto'

import type {
  BlockRelation,
  CreateBlockParams,
  DeleteBlockByUriParams,
  DeleteBlockParams,
  GetBlockByUriParams,
  GetBlockParams,
  GetBlockRelationsParams,
  GetBlocksParams,
  GetLocalBlockerIdsParams,
  GetRemoteBlockersParams,
  IsBlockingParams,
  IsEitherBlockingParams
} from '@/lib/database/domains/block/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { chunkArray } from '@/lib/database/kysely/inList'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { CounterKey } from '@/lib/database/utils/counter'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import type { Block } from '@/lib/types/domain/block'

const BLOCK_RELATION_LOOKUP_CHUNK_SIZE = 1000

type BlockRow = {
  id: string
  actorId: string
  actorHost: string
  targetActorId: string
  targetActorHost: string
  uri: string
  createdAt: number | null
  updatedAt: number | null
}

const toBlock = (row: BlockRow): Block => ({
  id: row.id,
  actorId: row.actorId,
  actorHost: row.actorHost,
  targetActorId: row.targetActorId,
  targetActorHost: row.targetActorHost,
  uri: row.uri,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

export const getBlock = async (
  db: Db,
  { actorId, targetActorId }: GetBlockParams
): Promise<Block | null> => {
  const block = await db
    .selectFrom('blocks')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()
  return block ? toBlock(block) : null
}

export const getBlockByUri = async (
  db: Db,
  { uri }: GetBlockByUriParams
): Promise<Block | null> => {
  const block = await db
    .selectFrom('blocks')
    .selectAll()
    .where('uri', '=', uri)
    .limit(1)
    .executeTakeFirst()
  return block ? toBlock(block) : null
}

export const createBlock = async (
  db: Db,
  { actorId, targetActorId, uri }: CreateBlockParams
): Promise<Block> => {
  const existingBlock = await getBlock(db, { actorId, targetActorId })
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
    await inTransaction(db, async (trx) => {
      await trx
        .insertInto('blocks')
        .values({ ...block, createdAt: currentTime, updatedAt: currentTime })
        .execute()

      await increaseCounterValue(
        trx,
        CounterKey.totalBlocking(actorId),
        1,
        currentTime
      )
      await increaseCounterValue(
        trx,
        CounterKey.totalBlockedBy(targetActorId),
        1,
        currentTime
      )
    })
    return block
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error

    // A concurrent request inserted the same pair (or uri) first. The insert
    // failed before the counters were touched and the transaction rolled back,
    // so this runs on the root instance after it.
    const duplicatedBlock =
      (await getBlock(db, { actorId, targetActorId })) ||
      (await getBlockByUri(db, { uri }))
    if (duplicatedBlock) return duplicatedBlock
    throw error
  }
}

// Deletes the actor's block matched by target or uri and decrements both
// actors' counters, read from the deleted row.
const deleteBlockWhere = (
  db: Db,
  actorId: string,
  column: 'targetActorId' | 'uri',
  value: string
): Promise<Block | null> =>
  inTransaction(db, async (trx) => {
    const existingBlock = await trx
      .selectFrom('blocks')
      .selectAll()
      .where('actorId', '=', actorId)
      .where(column, '=', value)
      .limit(1)
      .executeTakeFirst()
    if (!existingBlock) return null

    const currentTime = new Date()
    await trx.deleteFrom('blocks').where('id', '=', existingBlock.id).execute()
    await decreaseCounterValue(
      trx,
      CounterKey.totalBlocking(existingBlock.actorId),
      1,
      currentTime
    )
    await decreaseCounterValue(
      trx,
      CounterKey.totalBlockedBy(existingBlock.targetActorId),
      1,
      currentTime
    )

    return toBlock(existingBlock)
  })

export const deleteBlock = (
  db: Db,
  { actorId, targetActorId }: DeleteBlockParams
): Promise<Block | null> =>
  deleteBlockWhere(db, actorId, 'targetActorId', targetActorId)

export const deleteBlockByUri = (
  db: Db,
  { actorId, uri }: DeleteBlockByUriParams
): Promise<Block | null> => deleteBlockWhere(db, actorId, 'uri', uri)

export const isBlocking = async (
  db: Db,
  { actorId, targetActorId }: IsBlockingParams
): Promise<boolean> => {
  const block = await db
    .selectFrom('blocks')
    .select('id')
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()
  return Boolean(block)
}

export const isEitherBlocking = async (
  db: Db,
  { actorIdA, actorIdB }: IsEitherBlockingParams
): Promise<boolean> => {
  const block = await db
    .selectFrom('blocks')
    .select('id')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('actorId', '=', actorIdA),
          eb('targetActorId', '=', actorIdB)
        ]),
        eb.and([
          eb('actorId', '=', actorIdB),
          eb('targetActorId', '=', actorIdA)
        ])
      ])
    )
    .limit(1)
    .executeTakeFirst()
  return Boolean(block)
}

export const getBlocks = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetBlocksParams
): Promise<Block[]> => {
  let query = db.selectFrom('blocks').selectAll().where('actorId', '=', actorId)

  const cursorId = maxId || minId || sinceId
  if (cursorId) {
    const cursor = await db
      .selectFrom('blocks')
      .select(['id', 'createdAt'])
      .where('actorId', '=', actorId)
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []

    const operator = maxId ? '<' : '>'
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt: cursor.createdAt ?? 0, tieBreaker: cursor.id },
        operator,
        'id'
      )
    )
  }

  const direction = minId ? 'asc' : 'desc'
  const blocks = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .limit(limit)
    .execute()
  return (minId ? blocks.reverse() : blocks).map(toBlock)
}

export const getBlockRelations = async (
  db: Db,
  { actorIds, targetActorIds }: GetBlockRelationsParams
): Promise<BlockRelation[]> => {
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

  // One query per (actor chunk, target chunk) pair, all in flight at once.
  const relationGroups = await Promise.all(
    actorIdChunks.flatMap((actorIdChunk) =>
      targetActorIdChunks.map((targetActorIdChunk) =>
        db
          .selectFrom('blocks')
          .select(['actorId', 'targetActorId'])
          .where((eb) =>
            eb.or([
              eb.and([
                eb('actorId', 'in', actorIdChunk),
                eb('targetActorId', 'in', targetActorIdChunk)
              ]),
              eb.and([
                eb('actorId', 'in', targetActorIdChunk),
                eb('targetActorId', 'in', actorIdChunk)
              ])
            ])
          )
          .execute()
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

export const getLocalBlockerIds = async (
  db: Db,
  { targetActorId }: GetLocalBlockerIdsParams
): Promise<string[]> => {
  const rows = await db
    .selectFrom('actors')
    .innerJoin('blocks', 'blocks.actorId', 'actors.id')
    .where('blocks.targetActorId', '=', targetActorId)
    .where(isLocalActor)
    .select('actors.id')
    .$narrowType<{ id: string }>()
    .execute()
  return rows.map((row) => row.id)
}

export const getRemoteBlockers = async (
  db: Db,
  { targetActorId, limit, maxId }: GetRemoteBlockersParams
): Promise<Block[]> => {
  let query = db
    .selectFrom('blocks')
    .innerJoin('actors', 'actors.id', 'blocks.actorId')
    .where('blocks.targetActorId', '=', targetActorId)
    .where((eb) => eb.not(isLocalActor(eb)))
  if (maxId) query = query.where('blocks.id', '<', maxId)
  const rows = await query
    .selectAll('blocks')
    .orderBy('blocks.id', 'desc')
    .limit(limit)
    .execute()
  return rows.map(toBlock)
}

// The facade getSQLDatabase binds with bindDb().
export const blockQueries = {
  createBlock,
  deleteBlock,
  deleteBlockByUri,
  getBlock,
  getBlockByUri,
  isBlocking,
  isEitherBlocking,
  getBlocks,
  getBlockRelations,
  getLocalBlockerIds,
  getRemoteBlockers
}
