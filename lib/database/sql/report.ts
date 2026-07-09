import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateReportParams,
  Report,
  ReportCategory,
  ReportDatabase
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
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('reports').insert(row)
    return fixReport(row as unknown as SQLReport)
  }
})
