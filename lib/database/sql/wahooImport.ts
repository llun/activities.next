import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'

export type WahooImportStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'unsupported'

export interface WahooImport {
  id: string
  actorId: string
  providerUserId: string
  workoutId: string
  summaryId?: string
  summaryUpdatedAt?: number
  fitnessFileId?: string
  statusId?: string
  historyImportId?: string
  status: WahooImportStatus
  hadStatus?: boolean
  attempts: number
  lastError?: string
}

export type WahooHistoryStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface WahooHistoryImport {
  id: string
  actorId: string
  providerUserId: string
  fromDate: string
  toDate: string
  nextPage: number
  scanComplete: boolean
  total: number
  completed: number
  failed: number
  status: WahooHistoryStatus
  lastError?: string
}

export interface WahooImportDatabase {
  upsertWahooImport(params: {
    actorId: string
    providerUserId: string
    workoutId: string
    summaryId?: string
    summaryUpdatedAt?: number
    historyImportId?: string
  }): Promise<WahooImport>
  getWahooImport(id: string): Promise<WahooImport | null>
  getWahooImportsByActor(params: {
    actorId: string
    statuses: WahooImportStatus[]
    limit?: number
  }): Promise<WahooImport[]>
  updateWahooImport(
    id: string,
    values: Partial<
      Pick<
        WahooImport,
        | 'status'
        | 'fitnessFileId'
        | 'statusId'
        | 'summaryId'
        | 'summaryUpdatedAt'
        | 'attempts'
      >
    > & { lastError?: string | null }
  ): Promise<void>
  markWahooImportFailed(
    id: string,
    status: 'failed' | 'unsupported',
    error: string
  ): Promise<void>
  markWahooImportPending(id: string): Promise<boolean>
  getLatestWahooHistoryImport(
    actorId: string
  ): Promise<WahooHistoryImport | null>
  getWahooHistoryImport(id: string): Promise<WahooHistoryImport | null>
  getWahooImportsByHistory(
    id: string,
    statuses?: WahooImportStatus[]
  ): Promise<WahooImport[]>
  cancelWahooHistoryImportsByActor(actorId: string): Promise<void>
  createWahooHistoryImport(params: {
    actorId: string
    providerUserId: string
    fromDate: string
    toDate: string
  }): Promise<WahooHistoryImport>
  updateWahooHistoryImport(
    id: string,
    values: Partial<
      Pick<
        WahooHistoryImport,
        | 'nextPage'
        | 'scanComplete'
        | 'total'
        | 'completed'
        | 'failed'
        | 'status'
      >
    > & { lastError?: string | null },
    expectedStatuses?: WahooHistoryStatus[]
  ): Promise<boolean>
  countWahooHistoryItems(id: string): Promise<{
    total: number
    completed: number
    failed: number
    pending: number
  }>
}

type SQLWahooImport = Omit<WahooImport, 'summaryUpdatedAt'> & {
  summaryUpdatedAt?: Date | string | null
}

const toImport = (row: SQLWahooImport): WahooImport => ({
  ...row,
  hadStatus: Boolean(row.hadStatus),
  summaryId: row.summaryId || undefined,
  summaryUpdatedAt: row.summaryUpdatedAt
    ? getCompatibleTime(row.summaryUpdatedAt)
    : undefined,
  fitnessFileId: row.fitnessFileId || undefined,
  statusId: row.statusId || undefined,
  historyImportId: row.historyImportId || undefined,
  lastError: row.lastError || undefined
})

const toHistory = (row: WahooHistoryImport): WahooHistoryImport => ({
  ...row,
  scanComplete: Boolean(row.scanComplete),
  fromDate: new Date(row.fromDate).toISOString().slice(0, 10),
  toDate: new Date(row.toDate).toISOString().slice(0, 10),
  lastError: row.lastError || undefined
})

export const WahooImportSQLDatabaseMixin = (
  database: Knex
): WahooImportDatabase => ({
  async upsertWahooImport({
    actorId,
    providerUserId,
    workoutId,
    summaryId,
    summaryUpdatedAt,
    historyImportId
  }) {
    const id = crypto.randomUUID()
    await database('wahoo_imports')
      .insert({
        id,
        actorId,
        providerUserId,
        workoutId,
        summaryId,
        summaryUpdatedAt: summaryUpdatedAt ? new Date(summaryUpdatedAt) : null,
        historyImportId,
        status: 'pending',
        hadStatus: false,
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .onConflict(['actorId', 'providerUserId', 'workoutId'])
      .ignore()

    const row = await database('wahoo_imports')
      .where({ actorId, providerUserId, workoutId })
      .first<SQLWahooImport>()
    if (!row) throw new Error('Wahoo import disappeared after insert')
    if (historyImportId && row.historyImportId !== historyImportId) {
      await database('wahoo_imports')
        .where({ id: row.id })
        .update({ historyImportId, updatedAt: new Date() })
      row.historyImportId = historyImportId
    }
    return toImport(row)
  },

  async getWahooImport(id) {
    const row = await database('wahoo_imports')
      .where({ id })
      .first<SQLWahooImport>()
    return row ? toImport(row) : null
  },

  async getWahooImportsByActor({ actorId, statuses, limit = 25 }) {
    const rows = await database('wahoo_imports')
      .where({ actorId })
      .whereIn('status', statuses)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .select<SQLWahooImport[]>()
    return rows.map(toImport)
  },

  async updateWahooImport(id, values) {
    const definedValues = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined)
    )
    await database('wahoo_imports')
      .where({ id })
      .update({
        ...definedValues,
        ...(values.statusId ? { hadStatus: true } : {}),
        ...(values.summaryUpdatedAt !== undefined
          ? { summaryUpdatedAt: new Date(values.summaryUpdatedAt) }
          : {}),
        updatedAt: new Date()
      })
  },

  async markWahooImportFailed(id, status, error) {
    await database('wahoo_imports')
      .where({ id })
      .whereNot('status', 'completed')
      .update({ status, lastError: error, updatedAt: new Date() })
  },

  async markWahooImportPending(id) {
    const changed = await database('wahoo_imports')
      .where({ id })
      .whereIn('status', ['failed', 'unsupported'])
      .update({ status: 'pending', lastError: null, updatedAt: new Date() })
    return changed > 0
  },

  async getLatestWahooHistoryImport(actorId) {
    const row = await database('wahoo_history_imports')
      .where({ actorId })
      .orderBy('createdAt', 'desc')
      .first<WahooHistoryImport>()
    return row ? toHistory(row) : null
  },

  async getWahooHistoryImport(id) {
    const row = await database('wahoo_history_imports')
      .where({ id })
      .first<WahooHistoryImport>()
    return row ? toHistory(row) : null
  },

  async getWahooImportsByHistory(id, statuses) {
    let query = database('wahoo_imports').where({ historyImportId: id })
    if (statuses) query = query.whereIn('status', statuses)
    const rows = await query.select<SQLWahooImport[]>()
    return rows.map(toImport)
  },

  async cancelWahooHistoryImportsByActor(actorId) {
    await database('wahoo_history_imports')
      .where({ actorId })
      .whereIn('status', ['pending', 'running', 'failed'])
      .update({ status: 'cancelled', updatedAt: new Date() })
  },

  async createWahooHistoryImport({
    actorId,
    providerUserId,
    fromDate,
    toDate
  }) {
    const row: WahooHistoryImport = {
      id: crypto.randomUUID(),
      actorId,
      providerUserId,
      fromDate,
      toDate,
      nextPage: 1,
      scanComplete: false,
      total: 0,
      completed: 0,
      failed: 0,
      status: 'pending'
    }
    await database('wahoo_history_imports').insert({
      ...row,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    return row
  },

  async updateWahooHistoryImport(id, values, expectedStatuses) {
    const definedValues = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined)
    )
    let query = database('wahoo_history_imports').where({ id })
    if (expectedStatuses) query = query.whereIn('status', expectedStatuses)
    const changed = await query.update({
      ...definedValues,
      updatedAt: new Date()
    })
    return changed > 0
  },

  async countWahooHistoryItems(id) {
    const rows = await database('wahoo_imports')
      .where({ historyImportId: id })
      .select('status')
    return {
      total: rows.length,
      completed: rows.filter((row) => row.status === 'completed').length,
      failed: rows.filter((row) =>
        ['failed', 'unsupported'].includes(row.status)
      ).length,
      pending: rows.filter((row) => ['pending', 'running'].includes(row.status))
        .length
    }
  }
})
