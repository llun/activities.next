import { Knex } from 'knex'

import {
  CreateStatusMuteParams,
  DeleteStatusMuteParams,
  GetActorMutedConversationRootIdsParams,
  IsConversationMutedParams,
  StatusMuteDatabase
} from '@/lib/types/database/operations'

export const StatusMuteSQLDatabaseMixin = (
  database: Knex
): StatusMuteDatabase => ({
  async createStatusMute({ actorId, statusId }: CreateStatusMuteParams) {
    const existing = await database('status_mutes')
      .where({ actorId, statusId })
      .first()
    if (existing) return

    const currentTime = new Date()
    await database('status_mutes').insert({
      actorId,
      statusId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
  },

  async deleteStatusMute({ actorId, statusId }: DeleteStatusMuteParams) {
    await database('status_mutes').where({ actorId, statusId }).delete()
  },

  async isConversationMuted({ actorId, statusId }: IsConversationMutedParams) {
    const row = await database('status_mutes')
      .where({ actorId, statusId })
      .first()
    return Boolean(row)
  },

  async getActorMutedConversationRootIds({
    actorId
  }: GetActorMutedConversationRootIdsParams) {
    const rows = await database('status_mutes')
      .where({ actorId })
      .select('statusId')
    return rows.map((row) => row.statusId)
  }
})
