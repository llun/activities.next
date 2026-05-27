import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  CreateMuteParams,
  DeleteMuteParams,
  GetMuteParams,
  GetMuteRelationsParams,
  IsMutingParams,
  MuteDatabase,
  MuteRelation
} from '@/lib/types/database/operations'
import { Mute } from '@/lib/types/domain/mute'

const fixMuteDataDate = (data: Mute): Mute => ({
  ...data,
  notifications: Boolean(data.notifications),
  endsAt:
    data.endsAt !== null && data.endsAt !== undefined
      ? Number(data.endsAt)
      : null,
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt)
})

// Each query uses two WHERE IN clauses (actorId + targetActorId).
// Keep chunk size at 400 so the combined parameter count (400 * 2 = 800)
// stays safely below SQLite's default limit of 999 bound parameters.
const MUTE_RELATION_LOOKUP_CHUNK_SIZE = 400

const chunkArray = <T>(items: T[], chunkSize: number) => {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

export const MuteSQLDatabaseMixin = (database: Knex): MuteDatabase => ({
  async createMute({
    actorId,
    targetActorId,
    notifications,
    endsAt
  }: CreateMuteParams) {
    const currentTime = new Date()

    // Use a raw DB lookup (no expiry filter) so that expired rows are updated
    // rather than triggering a unique-constraint violation on INSERT.
    const existingRow = await database<Mute>('mutes')
      .where({ actorId, targetActorId })
      .first()

    if (existingRow) {
      await database('mutes').where({ actorId, targetActorId }).update({
        notifications,
        endsAt,
        updatedAt: currentTime
      })
      return {
        ...fixMuteDataDate(existingRow),
        notifications,
        endsAt,
        updatedAt: currentTime.getTime()
      }
    }

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
      await database('mutes').insert({
        ...mute,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      return mute
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error

      // Race: another request inserted between our SELECT and INSERT — update it.
      const duplicated = await database<Mute>('mutes')
        .where({ actorId, targetActorId })
        .first()
      if (duplicated) {
        await database('mutes').where({ actorId, targetActorId }).update({
          notifications,
          endsAt,
          updatedAt: currentTime
        })
        return {
          ...fixMuteDataDate(duplicated),
          notifications,
          endsAt,
          updatedAt: currentTime.getTime()
        }
      }
      throw error
    }
  },

  async deleteMute({ actorId, targetActorId }: DeleteMuteParams) {
    const existingMute = await database<Mute>('mutes')
      .where({ actorId, targetActorId })
      .first()
    if (!existingMute) return null

    await database('mutes').where('id', existingMute.id).delete()
    return fixMuteDataDate(existingMute)
  },

  async getMute({ actorId, targetActorId }: GetMuteParams) {
    const mute = await database<Mute>('mutes')
      .where({ actorId, targetActorId })
      .first()
    if (!mute) return null
    const fixed = fixMuteDataDate(mute)
    if (fixed.endsAt !== null && fixed.endsAt < Date.now()) return null
    return fixed
  },

  async isMuting({ actorId, targetActorId }: IsMutingParams) {
    const mute = await database<Pick<Mute, 'id' | 'endsAt'>>('mutes')
      .where({ actorId, targetActorId })
      .first('id', 'endsAt')
    if (!mute) return false
    const endsAt =
      mute.endsAt !== null && mute.endsAt !== undefined
        ? Number(mute.endsAt)
        : null
    if (endsAt !== null && endsAt < Date.now()) return false
    return true
  },

  async getMuteRelations({
    actorIds,
    targetActorIds
  }: GetMuteRelationsParams) {
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
        const relations = await database<
          MuteRelation & { endsAt: number | null }
        >('mutes')
          .select('actorId', 'targetActorId', 'notifications', 'endsAt')
          .whereIn('actorId', actorIdChunk)
          .whereIn('targetActorId', targetActorIdChunk)

        for (const relation of relations) {
          const endsAt =
            relation.endsAt !== null && relation.endsAt !== undefined
              ? Number(relation.endsAt)
              : null
          if (endsAt !== null && endsAt < now) continue
          relationsByKey.set(
            JSON.stringify([relation.actorId, relation.targetActorId]),
            {
              actorId: relation.actorId,
              targetActorId: relation.targetActorId,
              notifications: Boolean(relation.notifications)
            }
          )
        }
      }
    }

    return [...relationsByKey.values()]
  }
})
