import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateScheduledStatusParams,
  DeleteScheduledStatusParams,
  GetDueScheduledStatusesParams,
  GetScheduledStatusByIdParams,
  GetScheduledStatusParams,
  GetScheduledStatusesParams,
  ScheduledStatusData,
  ScheduledStatusDatabase,
  UpdateScheduledStatusAtParams
} from '@/lib/types/database/operations'
import { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'

type SQLScheduledStatus = {
  id: string
  actorId: string
  scheduledAt: number | Date | string
  params: string
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const toScheduledStatus = (row: SQLScheduledStatus): ScheduledStatusData => ({
  id: row.id,
  actorId: row.actorId,
  scheduledAt: getCompatibleTime(row.scheduledAt),
  params: ScheduledStatusParams.parse(getCompatibleJSON(row.params)),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const ScheduledStatusSQLDatabaseMixin = (
  database: Knex
): ScheduledStatusDatabase => ({
  async createScheduledStatus({
    actorId,
    scheduledAt,
    params
  }: CreateScheduledStatusParams) {
    const currentTime = new Date()
    const row = {
      id: randomUUID(),
      actorId,
      scheduledAt: new Date(scheduledAt),
      params: JSON.stringify(params),
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('scheduled_statuses').insert(row)
    return {
      id: row.id,
      actorId,
      scheduledAt,
      params,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async getScheduledStatuses({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetScheduledStatusesParams) {
    const query = database<SQLScheduledStatus>('scheduled_statuses')
      .where('actorId', actorId)
      .limit(limit)

    // Cursors are row ids, but ids are random UUIDs, so comparing them directly
    // would shuffle pagination. Look the cursor row up and keyset on its
    // scheduledAt, with id as a stable tiebreaker — the same pattern the status
    // timeline uses on createdAt. The raw cursor value is passed straight into
    // the comparison (it is already in the column's storage format).
    // A cursor that no longer resolves (the row was published/deleted between
    // page requests) returns an empty page rather than silently falling back to
    // the first page, which would loop the client over duplicate results.
    if (maxId) {
      const cursor = await database<SQLScheduledStatus>('scheduled_statuses')
        .where({ actorId, id: maxId })
        .first()
      if (!cursor) return []
      query.where((wb) => {
        wb.where('scheduledAt', '<', cursor.scheduledAt).orWhere((tie) => {
          tie
            .where('scheduledAt', '=', cursor.scheduledAt)
            .where('id', '<', maxId)
        })
      })
    }

    const newerCursorId = minId || sinceId
    if (newerCursorId) {
      const cursor = await database<SQLScheduledStatus>('scheduled_statuses')
        .where({ actorId, id: newerCursorId })
        .first()
      if (!cursor) return []
      query.where((wb) => {
        wb.where('scheduledAt', '>', cursor.scheduledAt).orWhere((tie) => {
          tie
            .where('scheduledAt', '=', cursor.scheduledAt)
            .where('id', '>', newerCursorId)
        })
      })
    }

    if (minId) {
      query.orderBy('scheduledAt', 'asc').orderBy('id', 'asc')
    } else {
      query.orderBy('scheduledAt', 'desc').orderBy('id', 'desc')
    }

    const rows = await query
    return (minId ? rows.reverse() : rows).map(toScheduledStatus)
  },

  async getScheduledStatus({ actorId, id }: GetScheduledStatusParams) {
    const row = await database<SQLScheduledStatus>('scheduled_statuses')
      .where({ actorId, id })
      .first()
    if (!row) return null
    return toScheduledStatus(row)
  },

  async getScheduledStatusById({ id }: GetScheduledStatusByIdParams) {
    const row = await database<SQLScheduledStatus>('scheduled_statuses')
      .where({ id })
      .first()
    if (!row) return null
    return toScheduledStatus(row)
  },

  async updateScheduledStatusAt({
    actorId,
    id,
    scheduledAt
  }: UpdateScheduledStatusAtParams) {
    const updatedAt = new Date()
    // Do not key existence off the affected-row count: SQLite reports 0 changed
    // rows when scheduledAt is updated to its current value, which would falsely
    // 404 a no-op reschedule. Re-read the row instead — it is null only when the
    // (actorId, id) pair does not exist.
    await database('scheduled_statuses')
      .where({ actorId, id })
      .update({ scheduledAt: new Date(scheduledAt), updatedAt })

    const row = await database<SQLScheduledStatus>('scheduled_statuses')
      .where({ actorId, id })
      .first()
    return row ? toScheduledStatus(row) : null
  },

  async deleteScheduledStatus({ actorId, id }: DeleteScheduledStatusParams) {
    const deleted = await database('scheduled_statuses')
      .where({ actorId, id })
      .delete()
    return deleted > 0
  },

  async getDueScheduledStatuses({
    before,
    limit
  }: GetDueScheduledStatusesParams) {
    const query = database<SQLScheduledStatus>('scheduled_statuses')
      .where('scheduledAt', '<=', new Date(before))
      .orderBy('scheduledAt', 'asc')
      .orderBy('id', 'asc')
    if (limit) query.limit(limit)
    const rows = await query
    return rows.map(toScheduledStatus)
  }
})
