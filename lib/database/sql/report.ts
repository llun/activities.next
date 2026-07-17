import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  AssignReportParams,
  CreateReportParams,
  GetAdminReportsParams,
  GetReportByIdParams,
  Report,
  ReportCategory,
  ReportDatabase,
  UpdateReportCategoryParams
} from '@/lib/types/database/operations'

type SQLReport = {
  id: string
  actorId: string
  targetActorId: string
  category: string
  comment: string
  forward: boolean | number
  statusIds: string
  ruleIds: string
  collectionIds: string
  actionTaken: boolean | number
  assignedActorId: string | null
  actionTakenAt: number | Date | null
  actionTakenByActorId: string | null
  createdAt: number | Date
  updatedAt: number | Date
}

const fixReport = (row: SQLReport): Report => ({
  id: row.id,
  actorId: row.actorId,
  targetActorId: row.targetActorId,
  category: ReportCategory.catch('other').parse(row.category),
  comment: row.comment ?? '',
  forward: Boolean(row.forward),
  statusIds: getCompatibleJSON<string[]>(row.statusIds) ?? [],
  ruleIds: getCompatibleJSON<string[]>(row.ruleIds) ?? [],
  collectionIds: getCompatibleJSON<string[]>(row.collectionIds) ?? [],
  actionTaken: Boolean(row.actionTaken),
  assignedActorId: row.assignedActorId ?? null,
  actionTakenAt:
    row.actionTakenAt != null ? getCompatibleTime(row.actionTakenAt) : null,
  actionTakenByActorId: row.actionTakenByActorId ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const ReportSQLDatabaseMixin = (database: Knex): ReportDatabase => ({
  async createReport({
    actorId,
    targetActorId,
    category = 'other',
    comment = '',
    forward = false,
    statusIds = [],
    ruleIds = [],
    collectionIds = []
  }: CreateReportParams) {
    const currentTime = new Date()
    const row = {
      id: randomUUID(),
      actorId,
      targetActorId,
      category,
      comment,
      forward,
      statusIds: JSON.stringify(statusIds),
      ruleIds: JSON.stringify(ruleIds),
      collectionIds: JSON.stringify(collectionIds),
      actionTaken: false,
      assignedActorId: null,
      actionTakenAt: null,
      actionTakenByActorId: null,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('reports').insert(row)
    return fixReport(row as unknown as SQLReport)
  },

  async getAdminReports({
    resolved,
    accountId,
    targetActorId,
    byTargetDomain,
    limit = 100,
    maxId,
    minId,
    sinceId
  }: GetAdminReportsParams): Promise<Report[]> {
    const query = database<SQLReport>('reports').limit(limit)

    // `resolved` is Mastodon's name for the action_taken flag.
    if (resolved === true) query.where('actionTaken', true)
    if (resolved === false) query.where('actionTaken', false)
    if (accountId) query.where('actorId', accountId)
    if (targetActorId) query.where('targetActorId', targetActorId)
    if (byTargetDomain) {
      // Match reports whose target actor lives on the given domain.
      query.whereIn('targetActorId', function () {
        this.select('id')
          .from('actors')
          .whereRaw('lower(actors.domain) = ?', [byTargetDomain.toLowerCase()])
      })
    }

    const cursorCreatedAt = async (id: string) => {
      const row = await database<SQLReport>('reports')
        .where('id', id)
        .select('createdAt')
        .first()
      return row?.createdAt ?? null
    }

    // Keyset on (createdAt desc, id) with raw-UUID cursors.
    if (maxId) {
      const cursor = await cursorCreatedAt(maxId)
      if (cursor != null) {
        query.where(function () {
          this.where('createdAt', '<', cursor).orWhere(function () {
            this.where('createdAt', cursor).where('id', '<', maxId)
          })
        })
      }
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
      return rows.map(fixReport)
    }
    if (minId) {
      const cursor = await cursorCreatedAt(minId)
      if (cursor != null) {
        query.where(function () {
          this.where('createdAt', '>', cursor).orWhere(function () {
            this.where('createdAt', cursor).where('id', '>', minId)
          })
        })
      }
      const rows = await query.orderBy('createdAt', 'asc').orderBy('id', 'asc')
      return rows.reverse().map(fixReport)
    }
    if (sinceId) {
      const cursor = await cursorCreatedAt(sinceId)
      if (cursor != null) {
        query.where(function () {
          this.where('createdAt', '>', cursor).orWhere(function () {
            this.where('createdAt', cursor).where('id', '>', sinceId)
          })
        })
      }
      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
      return rows.map(fixReport)
    }

    const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    return rows.map(fixReport)
  },

  async getReportById({
    reportId
  }: GetReportByIdParams): Promise<Report | null> {
    const row = await database<SQLReport>('reports')
      .where('id', reportId)
      .first()
    return row ? fixReport(row) : null
  },

  async updateReportCategory({
    reportId,
    category,
    ruleIds
  }: UpdateReportCategoryParams): Promise<Report | null> {
    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (category !== undefined) update.category = category
    if (ruleIds !== undefined) update.ruleIds = JSON.stringify(ruleIds)
    await database('reports').where('id', reportId).update(update)
    return this.getReportById({ reportId })
  },

  async assignReport({
    reportId,
    assignedActorId
  }: AssignReportParams): Promise<Report | null> {
    await database('reports')
      .where('id', reportId)
      .update({ assignedActorId, updatedAt: new Date() })
    return this.getReportById({ reportId })
  }
})
