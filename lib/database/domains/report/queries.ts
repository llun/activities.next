import { randomUUID } from 'node:crypto'

import {
  type AssignReportParams,
  type CreateReportParams,
  type GetAdminReportsParams,
  type GetReportByIdParams,
  type Report,
  ReportCategory,
  type UpdateReportCategoryParams
} from '@/lib/database/domains/report/types'
import type { Db } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'

const COLUMNS = [
  'id',
  'actorId',
  'targetActorId',
  'category',
  'comment',
  'forward',
  'statusIds',
  'ruleIds',
  'collectionIds',
  'actionTaken',
  'assignedActorId',
  'actionTakenAt',
  'actionTakenByActorId',
  'createdAt',
  'updatedAt'
] as const

type Row = {
  id: string
  actorId: string
  targetActorId: string
  category: string
  comment: string
  forward: boolean
  // JSON arrays in `text` columns, which the driver hands back unparsed.
  statusIds: string
  ruleIds: string
  collectionIds: string
  actionTaken: boolean
  assignedActorId: string | null
  actionTakenAt: number | null
  actionTakenByActorId: string | null
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

const parseIds = (json: string) => (JSON.parse(json) as string[] | null) ?? []

const toReport = (row: Row): Report => ({
  id: row.id,
  actorId: row.actorId,
  targetActorId: row.targetActorId,
  category: ReportCategory.catch('other').parse(row.category),
  comment: row.comment,
  forward: row.forward,
  statusIds: parseIds(row.statusIds),
  ruleIds: parseIds(row.ruleIds),
  collectionIds: parseIds(row.collectionIds),
  actionTaken: row.actionTaken,
  assignedActorId: row.assignedActorId,
  actionTakenAt: row.actionTakenAt,
  actionTakenByActorId: row.actionTakenByActorId,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

export const createReport = async (
  db: Db,
  {
    actorId,
    targetActorId,
    category = 'other',
    comment = '',
    forward = false,
    statusIds = [],
    ruleIds = [],
    collectionIds = []
  }: CreateReportParams
): Promise<Report> => {
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
    actionTakenByActorId: null
  }
  await db
    .insertInto('reports')
    .values({ ...row, createdAt: currentTime, updatedAt: currentTime })
    .execute()
  return toReport({
    ...row,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  })
}

export const getAdminReports = async (
  db: Db,
  {
    resolved,
    accountId,
    targetActorId,
    byTargetDomain,
    limit = 100,
    maxId,
    minId,
    sinceId
  }: GetAdminReportsParams
): Promise<Report[]> => {
  let query = db.selectFrom('reports').select(COLUMNS).limit(limit)

  // `resolved` is Mastodon's name for the action_taken flag.
  if (resolved === true) query = query.where('actionTaken', '=', true)
  if (resolved === false) query = query.where('actionTaken', '=', false)
  if (accountId) query = query.where('actorId', '=', accountId)
  if (targetActorId) query = query.where('targetActorId', '=', targetActorId)
  if (byTargetDomain) {
    // Match reports whose target actor lives on the given domain.
    const domain = byTargetDomain.toLowerCase()
    query = query.where('targetActorId', 'in', (eb) =>
      eb
        .selectFrom('actors')
        .select('actors.id')
        .where((actor) =>
          actor(actor.fn('lower', ['actors.domain']), '=', domain)
        )
    )
  }

  // Keyset on (createdAt desc, id) with raw-UUID cursors. An unknown cursor id
  // applies no keyset condition, so the page starts from the top.
  const cursorId = maxId || minId || sinceId
  if (cursorId) {
    const cursor = await db
      .selectFrom('reports')
      .select('createdAt')
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (cursor?.createdAt != null) {
      const createdAt = cursor.createdAt
      query = query.where((eb) =>
        pastKeyset(
          eb,
          { createdAt, tieBreaker: cursorId },
          maxId ? '<' : '>',
          'id'
        )
      )
    }
  }

  // min_id pages upwards (oldest first) and is flipped back to newest first;
  // max_id and since_id both read newest first.
  const direction = !maxId && minId ? 'asc' : 'desc'
  const rows = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .execute()
  return (direction === 'asc' ? rows.reverse() : rows).map(toReport)
}

export const getReportById = async (
  db: Db,
  { reportId }: GetReportByIdParams
): Promise<Report | null> => {
  const row = await db
    .selectFrom('reports')
    .select(COLUMNS)
    .where('id', '=', reportId)
    .limit(1)
    .executeTakeFirst()
  return row ? toReport(row) : null
}

export const updateReportCategory = async (
  db: Db,
  { reportId, category, ruleIds }: UpdateReportCategoryParams
): Promise<Report | null> => {
  await db
    .updateTable('reports')
    .set({
      updatedAt: new Date(),
      ...(category !== undefined ? { category } : {}),
      ...(ruleIds !== undefined ? { ruleIds: JSON.stringify(ruleIds) } : {})
    })
    .where('id', '=', reportId)
    .execute()
  return getReportById(db, { reportId })
}

export const assignReport = async (
  db: Db,
  { reportId, assignedActorId }: AssignReportParams
): Promise<Report | null> => {
  await db
    .updateTable('reports')
    .set({ assignedActorId, updatedAt: new Date() })
    .where('id', '=', reportId)
    .execute()
  return getReportById(db, { reportId })
}

export const reportQueries = {
  createReport,
  getAdminReports,
  getReportById,
  updateReportCategory,
  assignReport
}
