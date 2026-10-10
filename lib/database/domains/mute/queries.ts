import type { ExpressionBuilder } from 'kysely'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import type {
  CreateMuteParams,
  DeleteMuteParams,
  GetMuteParams,
  GetMuteRelationsParams,
  GetMutesParams,
  MuteRelation
} from '@/lib/database/domains/mute/types'
import type { DB, Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import type { Mute } from '@/lib/types/domain/mute'

// Each query uses two WHERE IN clauses (actorId + targetActorId).
// Keep chunk size at 400 so the combined parameter count (400 * 2 = 800)
// stays safely below SQLite's default limit of 999 bound parameters.
const MUTE_RELATION_LOOKUP_CHUNK_SIZE = 400

type MuteRow = {
  id: string
  actorId: string
  actorHost: string
  targetActorId: string
  targetActorHost: string
  notifications: boolean
  endsAt: number | null
  createdAt: number | null
  updatedAt: number | null
}

const toMute = (row: MuteRow): Mute => ({
  id: row.id,
  actorId: row.actorId,
  actorHost: row.actorHost,
  targetActorId: row.targetActorId,
  targetActorHost: row.targetActorHost,
  notifications: row.notifications,
  endsAt: row.endsAt,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const selectMuteRow = (db: Db, actorId: string, targetActorId: string) =>
  db
    .selectFrom('mutes')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()

// (updatedAt, id) keyset: mutes are ranked by updatedAt, which the shared
// createdAt keyset (lib/database/kysely/keyset.ts) cannot express.
const pastUpdatedAt = (
  eb: ExpressionBuilder<DB, 'mutes'>,
  cursor: { updatedAt: number; id: string },
  operator: '<' | '>'
) => {
  const updatedAt = timestampValue(cursor.updatedAt)
  return eb.or([
    eb('updatedAt', operator, updatedAt),
    eb.and([eb('updatedAt', '=', updatedAt), eb('id', operator, cursor.id)])
  ])
}

export const createMute = async (
  db: Db,
  { actorId, targetActorId, notifications, endsAt }: CreateMuteParams
): Promise<Mute> => {
  const currentTime = new Date()

  const remute = async (row: MuteRow): Promise<Mute> => {
    await db
      .updateTable('mutes')
      .set({ notifications, endsAt, updatedAt: currentTime })
      .where('actorId', '=', actorId)
      .where('targetActorId', '=', targetActorId)
      .execute()
    return {
      ...toMute(row),
      notifications,
      endsAt,
      updatedAt: currentTime.getTime()
    }
  }

  // Use a raw DB lookup (no expiry filter) so that expired rows are updated
  // rather than triggering a unique-constraint violation on INSERT.
  const existingRow = await selectMuteRow(db, actorId, targetActorId)
  if (existingRow) return remute(existingRow)

  const mute: Mute = {
    id: randomUUID(),
    actorId,
    actorHost: new URL(actorId).host,
    targetActorId,
    targetActorHost: new URL(targetActorId).host,
    notifications,
    endsAt,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }

  try {
    await db
      .insertInto('mutes')
      .values({ ...mute, createdAt: currentTime, updatedAt: currentTime })
      .execute()
    return mute
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error

    // Race: another request inserted between our SELECT and INSERT — update it.
    const duplicated = await selectMuteRow(db, actorId, targetActorId)
    if (duplicated) return remute(duplicated)
    throw error
  }
}

export const deleteMute = async (
  db: Db,
  { actorId, targetActorId }: DeleteMuteParams
): Promise<Mute | null> => {
  const existingMute = await selectMuteRow(db, actorId, targetActorId)
  if (!existingMute) return null

  await db.deleteFrom('mutes').where('id', '=', existingMute.id).execute()
  return toMute(existingMute)
}

export const getMute = async (
  db: Db,
  { actorId, targetActorId }: GetMuteParams
): Promise<Mute | null> => {
  const row = await selectMuteRow(db, actorId, targetActorId)
  if (!row) return null
  const mute = toMute(row)
  if (mute.endsAt !== null && mute.endsAt < Date.now()) return null
  return mute
}

export const getMutes = async (
  db: Db,
  { actorId, limit = PER_PAGE_LIMIT, maxId, minId, sinceId }: GetMutesParams
): Promise<Mute[]> => {
  // Ordering by updatedAt rather than createdAt so that re-muting an
  // expired row (which only bumps updatedAt) surfaces the freshly
  // reactivated mute at the top of the list, instead of leaving it
  // buried at its original creation position.
  const now = Date.now()
  let query = db
    .selectFrom('mutes')
    .selectAll()
    .where('actorId', '=', actorId)
    .where((eb) => eb.or([eb('endsAt', 'is', null), eb('endsAt', '>', now)]))

  const cursorId = maxId || minId || sinceId
  if (cursorId) {
    const cursor = await db
      .selectFrom('mutes')
      .select(['id', 'updatedAt'])
      .where('actorId', '=', actorId)
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []

    const operator = maxId ? '<' : '>'
    query = query.where((eb) =>
      pastUpdatedAt(
        eb,
        { updatedAt: cursor.updatedAt ?? 0, id: cursor.id },
        operator
      )
    )
  }

  const direction = minId ? 'asc' : 'desc'
  const mutes = await query
    .orderBy('updatedAt', direction)
    .orderBy('id', direction)
    .limit(limit)
    .execute()
  return (minId ? mutes.reverse() : mutes).map(toMute)
}

export const getMuteRelations = async (
  db: Db,
  { actorIds, targetActorIds }: GetMuteRelationsParams
): Promise<MuteRelation[]> => {
  const uniqueActorIds = [...new Set(actorIds)]
  const uniqueTargetActorIds = [...new Set(targetActorIds)]

  if (uniqueActorIds.length === 0 || uniqueTargetActorIds.length === 0) {
    return []
  }

  const relationsByKey = new Map<string, MuteRelation>()
  const actorIdChunks = chunkArray(
    uniqueActorIds,
    MUTE_RELATION_LOOKUP_CHUNK_SIZE
  )
  const targetActorIdChunks = chunkArray(
    uniqueTargetActorIds,
    MUTE_RELATION_LOOKUP_CHUNK_SIZE
  )
  const now = Date.now()

  for (const actorIdChunk of actorIdChunks) {
    for (const targetActorIdChunk of targetActorIdChunks) {
      const relations = await db
        .selectFrom('mutes')
        .select(['actorId', 'targetActorId', 'notifications', 'endsAt'])
        .where('actorId', 'in', actorIdChunk)
        .where('targetActorId', 'in', targetActorIdChunk)
        .execute()

      for (const relation of relations) {
        if (relation.endsAt !== null && relation.endsAt < now) continue
        relationsByKey.set(
          JSON.stringify([relation.actorId, relation.targetActorId]),
          {
            actorId: relation.actorId,
            targetActorId: relation.targetActorId,
            notifications: relation.notifications
          }
        )
      }
    }
  }

  return [...relationsByKey.values()]
}

// The facade getSQLDatabase binds with bindDb().
export const muteQueries = {
  createMute,
  deleteMute,
  getMute,
  getMutes,
  getMuteRelations
}
