import { randomUUID } from 'node:crypto'

import {
  KEYWORD_COLUMNS,
  type KeywordRow,
  applyKeywordChanges,
  groupKeywordsByFilter,
  insertKeywords,
  parseFilterContext,
  toFilterKeyword
} from '@/lib/database/domains/filter/rows'
import type {
  ActiveFilterRecord,
  AddFilterKeywordParams,
  AddFilterStatusParams,
  CreateFilterParams,
  DeleteFilterKeywordParams,
  DeleteFilterParams,
  DeleteFilterStatusParams,
  GetActiveFiltersForActorParams,
  GetFilterKeywordParams,
  GetFilterKeywordsParams,
  GetFilterParams,
  GetFilterRecordsForActorParams,
  GetFilterStatusParams,
  GetFilterStatusesParams,
  UpdateFilterKeywordParams,
  UpdateFilterParams
} from '@/lib/database/domains/filter/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  type Filter,
  FilterAction,
  type FilterKeyword,
  type FilterStatus
} from '@/lib/types/domain/filter'

const FILTER_COLUMNS = [
  'id',
  'actorId',
  'title',
  'context',
  'filterAction',
  'expiresAt',
  'createdAt',
  'updatedAt'
] as const

const STATUS_COLUMNS = ['id', 'filterId', 'statusId', 'createdAt'] as const

type FilterRow = {
  id: string
  actorId: string
  title: string
  // JSON array in a `text` column.
  context: string
  filterAction: string
  expiresAt: number | null
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

type StatusRow = {
  id: string
  filterId: string
  statusId: string
  createdAt: number | null
}

const toFilter = (row: FilterRow): Filter => ({
  id: row.id,
  actorId: row.actorId,
  title: row.title,
  context: parseFilterContext(row.context),
  filterAction: FilterAction.parse(row.filterAction),
  expiresAt: row.expiresAt,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const toFilterStatus = (row: StatusRow): FilterStatus => ({
  id: row.id,
  filterId: row.filterId,
  statusId: row.statusId,
  createdAt: row.createdAt ?? 0
})

const isFilterActive = (filter: Filter, now: number): boolean =>
  filter.expiresAt === null || filter.expiresAt >= now

const getOwnedFilter = async (
  db: Db,
  actorId: string,
  filterId: string
): Promise<Filter | null> => {
  const row = await db
    .selectFrom('filters')
    .select(FILTER_COLUMNS)
    .where('id', '=', filterId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return row ? toFilter(row) : null
}

const findKeyword = (db: Db, id: string) =>
  db
    .selectFrom('filter_keywords')
    .select(KEYWORD_COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

const findStatus = (db: Db, id: string) =>
  db
    .selectFrom('filter_statuses')
    .select(STATUS_COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

const hydrateFilters = async (
  db: Db,
  filters: Filter[]
): Promise<ActiveFilterRecord[]> => {
  if (filters.length === 0) return []

  const filterIds = filters.map((filter) => filter.id)
  const [keywordRows, statusRows] = await Promise.all([
    selectInChunks<string, KeywordRow>(db, filterIds, (chunk) =>
      db
        .selectFrom('filter_keywords')
        .select(KEYWORD_COLUMNS)
        .where('filterId', 'in', chunk)
        .execute()
    ),
    selectInChunks<string, StatusRow>(db, filterIds, (chunk) =>
      db
        .selectFrom('filter_statuses')
        .select(STATUS_COLUMNS)
        .where('filterId', 'in', chunk)
        .execute()
    )
  ])

  const keywordsByFilter = groupKeywordsByFilter(keywordRows)
  const statusesByFilter = new Map<string, FilterStatus[]>()
  for (const row of statusRows) {
    const status = toFilterStatus(row)
    const bucket = statusesByFilter.get(status.filterId) ?? []
    bucket.push(status)
    statusesByFilter.set(status.filterId, bucket)
  }

  return filters.map((filter) => ({
    filter,
    keywords: keywordsByFilter.get(filter.id) ?? [],
    statuses: statusesByFilter.get(filter.id) ?? []
  }))
}

export const createFilter = async (
  db: Db,
  {
    actorId,
    title,
    context,
    filterAction,
    expiresAt,
    keywords = []
  }: CreateFilterParams
): Promise<Filter> => {
  const now = new Date()
  const filter: Filter = {
    id: randomUUID(),
    actorId,
    title,
    context,
    filterAction,
    expiresAt,
    createdAt: now.getTime(),
    updatedAt: now.getTime()
  }

  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('filters')
      .values({
        id: filter.id,
        actorId: filter.actorId,
        title: filter.title,
        context: JSON.stringify(filter.context),
        filterAction: filter.filterAction,
        expiresAt: filter.expiresAt,
        createdAt: now,
        updatedAt: now
      })
      .execute()

    await insertKeywords(trx, 'filter_keywords', filter.id, keywords, now)
  })

  return filter
}

export const getFilter = (
  db: Db,
  { actorId, id }: GetFilterParams
): Promise<Filter | null> => getOwnedFilter(db, actorId, id)

export const updateFilter = async (
  db: Db,
  {
    actorId,
    id,
    title,
    context,
    filterAction,
    expiresAt,
    keywords
  }: UpdateFilterParams
): Promise<Filter | null> => {
  const existing = await getOwnedFilter(db, actorId, id)
  if (!existing) return null

  const now = new Date()
  const updated: Filter = {
    ...existing,
    title: title ?? existing.title,
    context: context ?? existing.context,
    filterAction: filterAction ?? existing.filterAction,
    expiresAt: expiresAt === undefined ? existing.expiresAt : expiresAt,
    updatedAt: now.getTime()
  }

  await inTransaction(db, async (trx) => {
    await trx
      .updateTable('filters')
      .set({
        title: updated.title,
        context: JSON.stringify(updated.context),
        filterAction: updated.filterAction,
        expiresAt: updated.expiresAt,
        updatedAt: now
      })
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .execute()

    if (!keywords) return

    await applyKeywordChanges(trx, 'filter_keywords', id, keywords, now)
  })

  return updated
}

export const deleteFilter = async (
  db: Db,
  { actorId, id }: DeleteFilterParams
): Promise<Filter | null> => {
  const existing = await getOwnedFilter(db, actorId, id)
  if (!existing) return null
  await inTransaction(db, async (trx) => {
    await trx.deleteFrom('filter_statuses').where('filterId', '=', id).execute()
    await trx.deleteFrom('filter_keywords').where('filterId', '=', id).execute()
    await trx.deleteFrom('filters').where('id', '=', id).execute()
  })
  return existing
}

export const getActiveFiltersForActor = async (
  db: Db,
  { actorId, context }: GetActiveFiltersForActorParams
): Promise<ActiveFilterRecord[]> => {
  const rows = await db
    .selectFrom('filters')
    .select(FILTER_COLUMNS)
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'desc')
    .execute()
  const now = Date.now()
  const filters = rows
    .map(toFilter)
    .filter((filter) => isFilterActive(filter, now))
    .filter((filter) => !context || filter.context.includes(context))

  return hydrateFilters(db, filters)
}

export const getFilterRecordsForActor = async (
  db: Db,
  { actorId }: GetFilterRecordsForActorParams
): Promise<ActiveFilterRecord[]> => {
  // Oldest-first (creation order) so the management list is stable as new
  // filters are appended at the bottom.
  const rows = await db
    .selectFrom('filters')
    .select(FILTER_COLUMNS)
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'asc')
    .execute()
  return hydrateFilters(db, rows.map(toFilter))
}

export const addFilterKeyword = async (
  db: Db,
  { actorId, filterId, keyword, wholeWord }: AddFilterKeywordParams
): Promise<FilterKeyword | null> => {
  const filter = await getOwnedFilter(db, actorId, filterId)
  if (!filter) return null
  const now = new Date()
  const row: FilterKeyword = {
    id: randomUUID(),
    filterId,
    keyword,
    wholeWord: Boolean(wholeWord),
    createdAt: now.getTime(),
    updatedAt: now.getTime()
  }
  const { numInsertedOrUpdatedRows } = await db
    .insertInto('filter_keywords')
    .values({ ...row, createdAt: now, updatedAt: now })
    .onConflict((oc) => oc.columns(['filterId', 'keyword']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) return row

  // The keyword already exists on this filter: return the existing one.
  const existing = await db
    .selectFrom('filter_keywords')
    .select(KEYWORD_COLUMNS)
    .where('filterId', '=', filterId)
    .where('keyword', '=', keyword)
    .limit(1)
    .executeTakeFirst()
  return existing ? toFilterKeyword(existing) : null
}

export const getFilterKeywords = async (
  db: Db,
  { actorId, filterId }: GetFilterKeywordsParams
): Promise<FilterKeyword[] | null> => {
  const filter = await getOwnedFilter(db, actorId, filterId)
  if (!filter) return null
  const rows = await db
    .selectFrom('filter_keywords')
    .select(KEYWORD_COLUMNS)
    .where('filterId', '=', filterId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toFilterKeyword)
}

export const getFilterKeyword = async (
  db: Db,
  { actorId, id }: GetFilterKeywordParams
): Promise<FilterKeyword | null> => {
  const row = await findKeyword(db, id)
  if (!row) return null
  const filter = await getOwnedFilter(db, actorId, row.filterId)
  if (!filter) return null
  return toFilterKeyword(row)
}

export const updateFilterKeyword = async (
  db: Db,
  { actorId, id, keyword, wholeWord }: UpdateFilterKeywordParams
): Promise<FilterKeyword | null | 'duplicate'> => {
  const row = await findKeyword(db, id)
  if (!row) return null
  const filter = await getOwnedFilter(db, actorId, row.filterId)
  if (!filter) return null

  const now = new Date()
  try {
    await db
      .updateTable('filter_keywords')
      .set({
        updatedAt: now,
        ...(keyword !== undefined ? { keyword } : {}),
        ...(wholeWord !== undefined ? { wholeWord } : {})
      })
      .where('id', '=', id)
      .execute()
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    return 'duplicate'
  }

  return toFilterKeyword({
    ...row,
    keyword: keyword ?? row.keyword,
    wholeWord: wholeWord ?? row.wholeWord,
    updatedAt: now.getTime()
  })
}

export const deleteFilterKeyword = async (
  db: Db,
  { actorId, id }: DeleteFilterKeywordParams
): Promise<FilterKeyword | null> => {
  const row = await findKeyword(db, id)
  if (!row) return null
  const filter = await getOwnedFilter(db, actorId, row.filterId)
  if (!filter) return null

  await db.deleteFrom('filter_keywords').where('id', '=', id).execute()
  return toFilterKeyword(row)
}

export const addFilterStatus = async (
  db: Db,
  { actorId, filterId, statusId }: AddFilterStatusParams
): Promise<FilterStatus | null> => {
  const filter = await getOwnedFilter(db, actorId, filterId)
  if (!filter) return null

  const now = new Date()
  const row: FilterStatus = {
    id: randomUUID(),
    filterId,
    statusId,
    createdAt: now.getTime()
  }
  const { numInsertedOrUpdatedRows } = await db
    .insertInto('filter_statuses')
    .values({ ...row, createdAt: now })
    .onConflict((oc) => oc.columns(['filterId', 'statusId']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) return row

  // The status is already filtered by this filter: return the existing row.
  const existing = await db
    .selectFrom('filter_statuses')
    .select(STATUS_COLUMNS)
    .where('filterId', '=', filterId)
    .where('statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return existing ? toFilterStatus(existing) : null
}

export const getFilterStatuses = async (
  db: Db,
  { actorId, filterId }: GetFilterStatusesParams
): Promise<FilterStatus[] | null> => {
  const filter = await getOwnedFilter(db, actorId, filterId)
  if (!filter) return null
  const rows = await db
    .selectFrom('filter_statuses')
    .select(STATUS_COLUMNS)
    .where('filterId', '=', filterId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toFilterStatus)
}

export const getFilterStatus = async (
  db: Db,
  { actorId, id }: GetFilterStatusParams
): Promise<FilterStatus | null> => {
  const row = await findStatus(db, id)
  if (!row) return null
  const filter = await getOwnedFilter(db, actorId, row.filterId)
  if (!filter) return null
  return toFilterStatus(row)
}

export const deleteFilterStatus = async (
  db: Db,
  { actorId, id }: DeleteFilterStatusParams
): Promise<FilterStatus | null> => {
  const row = await findStatus(db, id)
  if (!row) return null
  const filter = await getOwnedFilter(db, actorId, row.filterId)
  if (!filter) return null

  await db.deleteFrom('filter_statuses').where('id', '=', id).execute()
  return toFilterStatus(row)
}

export const filterQueries = {
  createFilter,
  getFilter,
  updateFilter,
  deleteFilter,
  getActiveFiltersForActor,
  getFilterRecordsForActor,
  addFilterKeyword,
  getFilterKeywords,
  getFilterKeyword,
  updateFilterKeyword,
  deleteFilterKeyword,
  addFilterStatus,
  getFilterStatuses,
  getFilterStatus,
  deleteFilterStatus
}
