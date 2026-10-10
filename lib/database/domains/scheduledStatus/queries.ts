import type { ExpressionBuilder } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  CreateScheduledStatusParams,
  DeleteScheduledStatusParams,
  GetScheduledStatusByIdParams,
  GetScheduledStatusParams,
  GetScheduledStatusesParams,
  ScheduledStatusData,
  UpdateScheduledStatusAtParams
} from '@/lib/database/domains/scheduledStatus/types'
import type { Db } from '@/lib/database/kysely'
import type { DB } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'

const COLUMNS = [
  'id',
  'actorId',
  'scheduledAt',
  'params',
  'createdAt',
  'updatedAt'
] as const

type Row = {
  id: string
  actorId: string
  scheduledAt: number
  // JSON text: the column is `text`, so the driver hands it back unparsed.
  params: string
  createdAt: number
  updatedAt: number
}

const toScheduledStatus = (row: Row): ScheduledStatusData => ({
  id: row.id,
  actorId: row.actorId,
  scheduledAt: row.scheduledAt,
  params: ScheduledStatusParams.parse(JSON.parse(row.params)),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

// Rows before (`<`) or after (`>`) the cursor row in (scheduledAt, id) order.
// Not pastKeyset: that helper pages on createdAt, and this list is ordered by
// the time the status is scheduled for.
const pastCursor = (
  eb: ExpressionBuilder<DB, 'scheduled_statuses'>,
  cursor: { scheduledAt: number; id: string },
  operator: '<' | '>'
) => {
  const scheduledAt = timestampValue(cursor.scheduledAt)
  return eb.or([
    eb('scheduledAt', operator, scheduledAt),
    eb.and([eb('scheduledAt', '=', scheduledAt), eb('id', operator, cursor.id)])
  ])
}

const findOwned = (db: Db, actorId: string, id: string) =>
  db
    .selectFrom('scheduled_statuses')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

export const createScheduledStatus = async (
  db: Db,
  { actorId, scheduledAt, params }: CreateScheduledStatusParams
): Promise<ScheduledStatusData> => {
  const currentTime = new Date()
  const id = randomUUID()
  await db
    .insertInto('scheduled_statuses')
    .values({
      id,
      actorId,
      scheduledAt: new Date(scheduledAt),
      params: JSON.stringify(params),
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  return {
    id,
    actorId,
    scheduledAt,
    params,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
}

export const getScheduledStatuses = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetScheduledStatusesParams
): Promise<ScheduledStatusData[]> => {
  let query = db
    .selectFrom('scheduled_statuses')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .limit(limit)

  // Cursors are row ids, but ids are random UUIDs, so comparing them directly
  // would shuffle pagination. Look the cursor row up and keyset on its
  // scheduledAt, with id as a stable tiebreaker — the same pattern the status
  // timeline uses on createdAt.
  // A cursor that no longer resolves (the row was published/deleted between
  // page requests) returns an empty page rather than silently falling back to
  // the first page, which would loop the client over duplicate results.
  if (maxId) {
    const cursor = await findOwned(db, actorId, maxId)
    if (!cursor) return []
    query = query.where((eb) => pastCursor(eb, cursor, '<'))
  }

  const newerCursorId = minId || sinceId
  if (newerCursorId) {
    const cursor = await findOwned(db, actorId, newerCursorId)
    if (!cursor) return []
    query = query.where((eb) => pastCursor(eb, cursor, '>'))
  }

  const direction = minId ? 'asc' : 'desc'
  const rows = await query
    .orderBy('scheduledAt', direction)
    .orderBy('id', direction)
    .execute()
  return (minId ? rows.reverse() : rows).map(toScheduledStatus)
}

export const getScheduledStatus = async (
  db: Db,
  { actorId, id }: GetScheduledStatusParams
): Promise<ScheduledStatusData | null> => {
  const row = await findOwned(db, actorId, id)
  return row ? toScheduledStatus(row) : null
}

export const getScheduledStatusById = async (
  db: Db,
  { id }: GetScheduledStatusByIdParams
): Promise<ScheduledStatusData | null> => {
  const row = await db
    .selectFrom('scheduled_statuses')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toScheduledStatus(row) : null
}

export const updateScheduledStatusAt = async (
  db: Db,
  { actorId, id, scheduledAt }: UpdateScheduledStatusAtParams
): Promise<ScheduledStatusData | null> => {
  // Do not key existence off the affected-row count: SQLite reports 0 changed
  // rows when scheduledAt is updated to its current value, which would falsely
  // 404 a no-op reschedule. Re-read the row instead — it is null only when the
  // (actorId, id) pair does not exist.
  await db
    .updateTable('scheduled_statuses')
    .set({ scheduledAt: new Date(scheduledAt), updatedAt: new Date() })
    .where('actorId', '=', actorId)
    .where('id', '=', id)
    .execute()

  const row = await findOwned(db, actorId, id)
  return row ? toScheduledStatus(row) : null
}

export const deleteScheduledStatus = async (
  db: Db,
  { actorId, id }: DeleteScheduledStatusParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('scheduled_statuses')
    .where('actorId', '=', actorId)
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const scheduledStatusQueries = {
  createScheduledStatus,
  getScheduledStatuses,
  getScheduledStatus,
  getScheduledStatusById,
  updateScheduledStatusAt,
  deleteScheduledStatus
}
