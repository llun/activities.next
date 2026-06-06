import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateEndorsementParams,
  DeleteEndorsementParams,
  EndorsementDatabase,
  GetEndorsementParams,
  GetEndorsementsParams
} from '@/lib/types/database/operations'
import { Endorsement } from '@/lib/types/domain/endorsement'

interface SQLEndorsement {
  id: number | string
  actorId: string
  actorHost: string
  targetActorId: string
  targetActorHost: string
  createdAt: number | Date | string
}

const toEndorsement = (row: SQLEndorsement): Endorsement =>
  Endorsement.parse({
    id: `${row.id}`,
    actorId: row.actorId,
    actorHost: row.actorHost,
    targetActorId: row.targetActorId,
    targetActorHost: row.targetActorHost,
    createdAt: getCompatibleTime(row.createdAt)
  })

export const EndorsementSQLDatabaseMixin = (
  database: Knex
): EndorsementDatabase => ({
  async createEndorsement({ actorId, targetActorId }: CreateEndorsementParams) {
    // Idempotent: ignore on the (actorId, targetActorId) unique index, then
    // read back so concurrent endorse requests resolve to the same row.
    await database('endorsements')
      .insert({
        actorId,
        actorHost: new URL(actorId).host,
        targetActorId,
        targetActorHost: new URL(targetActorId).host,
        createdAt: new Date()
      })
      .onConflict(['actorId', 'targetActorId'])
      .ignore()

    const row = await database<SQLEndorsement>('endorsements')
      .where({ actorId, targetActorId })
      .first()
    // The row always exists after the insert/ignore above.
    return toEndorsement(row as SQLEndorsement)
  },

  async deleteEndorsement({ actorId, targetActorId }: DeleteEndorsementParams) {
    await database('endorsements').where({ actorId, targetActorId }).del()
  },

  async getEndorsement({ actorId, targetActorId }: GetEndorsementParams) {
    const row = await database<SQLEndorsement>('endorsements')
      .where({ actorId, targetActorId })
      .first()
    return row ? toEndorsement(row) : null
  },

  async getEndorsements({
    actorId,
    limit,
    maxId,
    minId
  }: GetEndorsementsParams) {
    const query = database<SQLEndorsement>('endorsements')
      .where({ actorId })
      .orderBy('id', 'desc')
      .limit(limit)

    // Numeric id cursors; guard NaN so a malformed cursor is ignored rather
    // than producing an invalid comparison.
    const max = maxId != null ? Number(maxId) : NaN
    const min = minId != null ? Number(minId) : NaN
    if (!Number.isNaN(max)) query.where('id', '<', max)
    if (!Number.isNaN(min)) query.where('id', '>', min)

    const rows = await query
    // When walking backwards with min_id, reverse to keep newest-first order.
    const ordered = !Number.isNaN(min) ? [...rows].reverse() : rows
    return ordered.map(toEndorsement)
  }
})
