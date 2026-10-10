import { type Selectable, type Updateable } from 'kysely'

import type {
  WahooHistoryImport,
  WahooHistoryStatus,
  WahooImport,
  WahooImportStatus
} from '@/lib/database/domains/wahooImport/types'
import type { Db } from '@/lib/database/kysely'
import type {
  WahooHistoryImports,
  WahooImports
} from '@/lib/database/kysely/db'

const toImport = (row: Selectable<WahooImports>): WahooImport => ({
  id: row.id,
  actorId: row.actorId,
  providerUserId: row.providerUserId,
  workoutId: row.workoutId,
  summaryId: row.summaryId || undefined,
  summaryUpdatedAt: row.summaryUpdatedAt ?? undefined,
  fitnessFileId: row.fitnessFileId || undefined,
  statusId: row.statusId || undefined,
  historyImportId: row.historyImportId || undefined,
  status: row.status as WahooImportStatus,
  hadStatus: row.hadStatus,
  attempts: row.attempts,
  lastError: row.lastError || undefined
})

const toHistory = (
  row: Selectable<WahooHistoryImports>
): WahooHistoryImport => ({
  id: row.id,
  actorId: row.actorId,
  providerUserId: row.providerUserId,
  fromDate: new Date(row.fromDate).toISOString().slice(0, 10),
  toDate: new Date(row.toDate).toISOString().slice(0, 10),
  nextPage: row.nextPage,
  scanComplete: row.scanComplete,
  total: row.total,
  completed: row.completed,
  failed: row.failed,
  status: row.status as WahooHistoryStatus,
  lastError: row.lastError || undefined
})

export const upsertWahooImport = async (
  db: Db,
  {
    actorId,
    providerUserId,
    workoutId,
    summaryId,
    summaryUpdatedAt,
    historyImportId
  }: {
    actorId: string
    providerUserId: string
    workoutId: string
    summaryId?: string
    summaryUpdatedAt?: number
    historyImportId?: string
  }
): Promise<WahooImport> => {
  const id = crypto.randomUUID()
  const now = new Date()
  await db
    .insertInto('wahoo_imports')
    .values({
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
      createdAt: now,
      updatedAt: now
    })
    .onConflict((oc) =>
      oc.columns(['actorId', 'providerUserId', 'workoutId']).doNothing()
    )
    .execute()

  const row = await db
    .selectFrom('wahoo_imports')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('providerUserId', '=', providerUserId)
    .where('workoutId', '=', workoutId)
    .limit(1)
    .executeTakeFirst()
  if (!row) throw new Error('Wahoo import disappeared after insert')
  let current = row
  if (historyImportId && row.historyImportId !== historyImportId) {
    await db
      .updateTable('wahoo_imports')
      .set({ historyImportId, updatedAt: new Date() })
      .where('id', '=', row.id)
      .execute()
    current = { ...row, historyImportId }
  }
  return {
    ...toImport(current),
    created: current.id === id
  }
}

export const getWahooImport = async (
  db: Db,
  id: string
): Promise<WahooImport | null> => {
  const row = await db
    .selectFrom('wahoo_imports')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toImport(row) : null
}

export const getWahooImportsByActor = async (
  db: Db,
  {
    actorId,
    statuses,
    limit = 25
  }: { actorId: string; statuses: WahooImportStatus[]; limit?: number }
): Promise<WahooImport[]> => {
  // `IN ()` is a syntax error on PostgreSQL; no statuses match nothing.
  if (statuses.length === 0) return []
  const rows = await db
    .selectFrom('wahoo_imports')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('status', 'in', statuses)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .execute()
  return rows.map(toImport)
}

export const updateWahooImport = async (
  db: Db,
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
): Promise<void> => {
  const set: Updateable<WahooImports> = { updatedAt: new Date() }
  if (values.status !== undefined) set.status = values.status
  if (values.fitnessFileId !== undefined) {
    set.fitnessFileId = values.fitnessFileId
  }
  if (values.statusId !== undefined) set.statusId = values.statusId
  // Once a status has been attached the import keeps the fact, even after the
  // status or its file is deleted and the references are cleared.
  if (values.statusId) set.hadStatus = true
  if (values.summaryId !== undefined) set.summaryId = values.summaryId
  if (values.summaryUpdatedAt !== undefined) {
    set.summaryUpdatedAt = new Date(values.summaryUpdatedAt)
  }
  if (values.attempts !== undefined) set.attempts = values.attempts
  if (values.lastError !== undefined) set.lastError = values.lastError
  await db.updateTable('wahoo_imports').set(set).where('id', '=', id).execute()
}

export const markWahooImportFailed = async (
  db: Db,
  id: string,
  status: 'failed' | 'unsupported',
  error: string
): Promise<void> => {
  await db
    .updateTable('wahoo_imports')
    .set({ status, lastError: error, updatedAt: new Date() })
    .where('id', '=', id)
    .where('status', '!=', 'completed')
    .execute()
}

export const markWahooImportPending = async (
  db: Db,
  id: string
): Promise<boolean> => {
  const { numUpdatedRows } = await db
    .updateTable('wahoo_imports')
    .set({ status: 'pending', lastError: null, updatedAt: new Date() })
    .where('id', '=', id)
    .where('status', 'in', ['failed', 'unsupported'])
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

export const getLatestWahooHistoryImport = async (
  db: Db,
  actorId: string
): Promise<WahooHistoryImport | null> => {
  const row = await db
    .selectFrom('wahoo_history_imports')
    .selectAll()
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toHistory(row) : null
}

export const getWahooHistoryImport = async (
  db: Db,
  id: string
): Promise<WahooHistoryImport | null> => {
  const row = await db
    .selectFrom('wahoo_history_imports')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toHistory(row) : null
}

export const getWahooImportsByHistory = async (
  db: Db,
  id: string,
  statuses?: WahooImportStatus[]
): Promise<WahooImport[]> => {
  if (statuses && statuses.length === 0) return []
  const rows = await db
    .selectFrom('wahoo_imports')
    .selectAll()
    .where('historyImportId', '=', id)
    .$if(statuses !== undefined, (qb) => qb.where('status', 'in', statuses!))
    .execute()
  return rows.map(toImport)
}

export const cancelWahooHistoryImportsByActor = async (
  db: Db,
  actorId: string
): Promise<void> => {
  await db
    .updateTable('wahoo_history_imports')
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where('actorId', '=', actorId)
    .where('status', 'in', ['pending', 'running', 'failed'])
    .execute()
}

export const createWahooHistoryImport = async (
  db: Db,
  {
    actorId,
    providerUserId,
    fromDate,
    toDate
  }: {
    actorId: string
    providerUserId: string
    fromDate: string
    toDate: string
  }
): Promise<WahooHistoryImport> => {
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
  const now = new Date()
  await db
    .insertInto('wahoo_history_imports')
    .values({ ...row, createdAt: now, updatedAt: now })
    .execute()
  return row
}

export const updateWahooHistoryImport = async (
  db: Db,
  id: string,
  values: Partial<
    Pick<
      WahooHistoryImport,
      'nextPage' | 'scanComplete' | 'total' | 'completed' | 'failed' | 'status'
    >
  > & { lastError?: string | null },
  expectedStatuses?: WahooHistoryStatus[]
): Promise<boolean> => {
  // No expected status can match, so nothing changes.
  if (expectedStatuses && expectedStatuses.length === 0) return false
  const set: Updateable<WahooHistoryImports> = { updatedAt: new Date() }
  if (values.nextPage !== undefined) set.nextPage = values.nextPage
  if (values.scanComplete !== undefined) {
    set.scanComplete = values.scanComplete
  }
  if (values.total !== undefined) set.total = values.total
  if (values.completed !== undefined) set.completed = values.completed
  if (values.failed !== undefined) set.failed = values.failed
  if (values.status !== undefined) set.status = values.status
  if (values.lastError !== undefined) set.lastError = values.lastError
  const { numUpdatedRows } = await db
    .updateTable('wahoo_history_imports')
    .set(set)
    .where('id', '=', id)
    .$if(expectedStatuses !== undefined, (qb) =>
      qb.where('status', 'in', expectedStatuses!)
    )
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

export const countWahooHistoryItems = async (
  db: Db,
  id: string
): Promise<{
  total: number
  completed: number
  failed: number
  pending: number
}> => {
  const rows = await db
    .selectFrom('wahoo_imports')
    .select('status')
    .where('historyImportId', '=', id)
    .execute()
  return {
    total: rows.length,
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => ['failed', 'unsupported'].includes(row.status))
      .length,
    pending: rows.filter((row) => ['pending', 'running'].includes(row.status))
      .length
  }
}

export const wahooImportQueries = {
  upsertWahooImport,
  getWahooImport,
  getWahooImportsByActor,
  updateWahooImport,
  markWahooImportFailed,
  markWahooImportPending,
  getLatestWahooHistoryImport,
  getWahooHistoryImport,
  getWahooImportsByHistory,
  cancelWahooHistoryImportsByActor,
  createWahooHistoryImport,
  updateWahooHistoryImport,
  countWahooHistoryItems
}
