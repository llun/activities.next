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
    minId,
    sinceId
  }: GetEndorsementsParams) {
    const query = database<SQLEndorsement>('endorsements')
      .where({ actorId })
      .limit(limit)

    // Numeric id cursors; a truthiness check guards both null/undefined and the
    // empty-string case (`?max_id=`), which would otherwise compare against 0.
    const max = maxId ? Number(maxId) : NaN
    const min = minId ? Number(minId) : NaN
    const since = sinceId ? Number(sinceId) : NaN
    if (!Number.isNaN(max)) query.where('id', '<', max)
    if (!Number.isNaN(min)) query.where('id', '>', min)
    if (!Number.isNaN(since)) query.where('id', '>', since)

    // min_id returns the OLDEST band immediately after the cursor: fetch
    // ascending (closest to the cursor), then present newest-first. Every other
    // cursor (max_id, since_id, none) returns the newest band, descending.
    if (!Number.isNaN(min)) {
      const rows = await query.orderBy('id', 'asc')
      return rows.reverse().map(toEndorsement)
    }
    const rows = await query.orderBy('id', 'desc')
    return rows.map(toEndorsement)
  }
})
