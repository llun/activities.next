import { randomUUID } from 'node:crypto'

import type {
  CreateActorDomainBlockParams,
  DeleteActorDomainBlockParams,
  GetActorDomainBlocksParams,
  IsDomainBlockedByActorParams
} from '@/lib/database/domains/actorDomainBlock/types'
import type { Db } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import type { ActorDomainBlock } from '@/lib/types/domain/actorDomainBlock'

const COLUMNS = ['id', 'actorId', 'domain', 'createdAt', 'updatedAt'] as const

type Row = {
  id: string
  actorId: string
  domain: string
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

const toActorDomainBlock = (row: Row): ActorDomainBlock => ({
  id: row.id,
  actorId: row.actorId,
  domain: row.domain,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const findBlock = (db: Db, actorId: string, domain: string) =>
  db
    .selectFrom('actor_domain_blocks')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()

export const createActorDomainBlock = async (
  db: Db,
  { actorId, domain }: CreateActorDomainBlockParams
): Promise<ActorDomainBlock> => {
  const existing = await findBlock(db, actorId, domain)
  if (existing) return toActorDomainBlock(existing)

  const currentTime = new Date()
  const block: ActorDomainBlock = {
    id: randomUUID(),
    actorId,
    domain,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }

  const { numInsertedOrUpdatedRows } = await db
    .insertInto('actor_domain_blocks')
    .values({
      ...block,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((oc) => oc.columns(['actorId', 'domain']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) return block

  // Race: another request inserted between our SELECT and INSERT.
  const duplicated = await findBlock(db, actorId, domain)
  if (duplicated) return toActorDomainBlock(duplicated)
  throw new Error('Failed to create actor domain block')
}

export const deleteActorDomainBlock = async (
  db: Db,
  { actorId, domain }: DeleteActorDomainBlockParams
): Promise<ActorDomainBlock | null> => {
  const existing = await findBlock(db, actorId, domain)
  if (!existing) return null

  await db
    .deleteFrom('actor_domain_blocks')
    .where('id', '=', existing.id)
    .execute()
  return toActorDomainBlock(existing)
}

export const isDomainBlockedByActor = async (
  db: Db,
  { actorId, domain }: IsDomainBlockedByActorParams
): Promise<boolean> => {
  const block = await db
    .selectFrom('actor_domain_blocks')
    .select('id')
    .where('actorId', '=', actorId)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()
  return Boolean(block)
}

export const getActorDomainBlocks = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetActorDomainBlocksParams
): Promise<ActorDomainBlock[]> => {
  let query = db
    .selectFrom('actor_domain_blocks')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
  if (limit !== undefined) query = query.limit(limit)

  const cursorId = maxId || minId || sinceId
  if (cursorId) {
    const cursor = await db
      .selectFrom('actor_domain_blocks')
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
    .execute()
  return (minId ? blocks.reverse() : blocks).map(toActorDomainBlock)
}

export const actorDomainBlockQueries = {
  createActorDomainBlock,
  deleteActorDomainBlock,
  isDomainBlockedByActor,
  getActorDomainBlocks
}
