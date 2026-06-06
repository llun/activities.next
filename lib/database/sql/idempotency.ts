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
    // Ignore on conflict so a concurrent request that already recorded the same
    // (actorId, key) does not surface a primary-key violation. The first writer
    // wins; this keeps the call safe under retries/races.
    await database('idempotency_keys')
      .insert({
        actorId,
        key,
        statusId,
        createdAt: new Date()
      })
      .onConflict(['actorId', 'key'])
      .ignore()
  }
})
