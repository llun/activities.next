import { Knex } from 'knex'

import {
  GetIdempotentStatusIdParams,
  IdempotencyDatabase,
  SaveIdempotencyKeyParams
} from '@/lib/types/database/operations'

export const IdempotencySQLDatabaseMixin = (
  database: Knex
): IdempotencyDatabase => ({
  async getIdempotentStatusId({ actorId, key }: GetIdempotentStatusIdParams) {
    const row = await database('idempotency_keys')
      .where({ actorId, key })
      .first('statusId')
    return row ? row.statusId : null
  },

  async saveIdempotencyKey({
    actorId,
    key,
    statusId
  }: SaveIdempotencyKeyParams) {
    const existing = await database('idempotency_keys')
      .where({ actorId, key })
      .first()
    if (existing) return

    await database('idempotency_keys').insert({
      actorId,
      key,
      statusId,
      createdAt: new Date()
    })
  }
})
