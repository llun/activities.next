import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateScheduledStatusParams,
  DeleteScheduledStatusParams,
  GetDueScheduledStatusesParams,
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
  params: ScheduledStatusParams.parse(JSON.parse(row.params)),
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

    if (maxId) query.where('id', '<', maxId)
    const newerCursorId = minId || sinceId
    if (newerCursorId) query.where('id', '>', newerCursorId)

    if (minId) {
      query.orderBy('id', 'asc')
    } else {
      query.orderBy('id', 'desc')
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

  async updateScheduledStatusAt({
    actorId,
    id,
    scheduledAt
  }: UpdateScheduledStatusAtParams) {
    const existing = await database<SQLScheduledStatus>('scheduled_statuses')
      .where({ actorId, id })
      .first()
    if (!existing) return null

    const updatedAt = new Date()
    await database('scheduled_statuses')
      .where({ actorId, id })
      .update({ scheduledAt: new Date(scheduledAt), updatedAt })

    return {
      ...toScheduledStatus(existing),
      scheduledAt,
      updatedAt: updatedAt.getTime()
    }
  },

  async deleteScheduledStatus({ actorId, id }: DeleteScheduledStatusParams) {
    const deleted = await database('scheduled_statuses')
      .where({ actorId, id })
      .delete()
    return deleted > 0
  },

  async getDueScheduledStatuses({ before }: GetDueScheduledStatusesParams) {
    const rows = await database<SQLScheduledStatus>('scheduled_statuses')
      .where('scheduledAt', '<=', new Date(before))
      .orderBy('scheduledAt', 'asc')
      .orderBy('id', 'asc')
    return rows.map(toScheduledStatus)
  }
})
