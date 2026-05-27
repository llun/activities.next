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

const MUTE_RELATION_LOOKUP_CHUNK_SIZE = 1000

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

    const existingMute = await this.getMute({ actorId, targetActorId })
    if (existingMute) {
      await database('mutes').where({ actorId, targetActorId }).update({
        notifications,
        endsAt,
        updatedAt: currentTime
      })
      return {
        ...existingMute,
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

      const duplicated = await this.getMute({ actorId, targetActorId })
      if (duplicated) {
        await database('mutes').where({ actorId, targetActorId }).update({
          notifications,
          endsAt,
          updatedAt: currentTime
        })
        return { ...duplicated, notifications, endsAt, updatedAt: currentTime.getTime() }
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
    return fixMuteDataDate(mute)
  },

  async isMuting({ actorId, targetActorId }: IsMutingParams) {
    const mute = await database('mutes')
      .where({ actorId, targetActorId })
      .first('id')
    return Boolean(mute)
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

    const relationGroups = await Promise.all(
      actorIdChunks.flatMap((actorIdChunk) =>
        targetActorIdChunks.map((targetActorIdChunk) =>
          database<MuteRelation>('mutes')
            .select('actorId', 'targetActorId', 'notifications')
            .whereIn('actorId', actorIdChunk)
            .whereIn('targetActorId', targetActorIdChunk)
        )
      )
    )

    for (const relations of relationGroups) {
      for (const relation of relations) {
        relationsByKey.set(
          JSON.stringify([relation.actorId, relation.targetActorId]),
          { ...relation, notifications: Boolean(relation.notifications) }
        )
      }
    }

    return [...relationsByKey.values()]
  }
})
