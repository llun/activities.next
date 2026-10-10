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
  ActiveServerFilterRecord,
  CreateServerFilterParams,
  DeleteServerFilterParams,
  GetActiveServerFiltersParams,
  GetServerFilterParams,
  UpdateServerFilterParams
} from '@/lib/database/domains/serverFilter/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { selectInChunks } from '@/lib/database/kysely/inList'
import {
  FilterAction,
  type FilterKeyword,
  type ServerFilter
} from '@/lib/types/domain/filter'

const COLUMNS = [
  'id',
  'title',
  'context',
  'filterAction',
  'expiresAt',
  'createdAt',
  'updatedAt'
] as const

type Row = {
  id: string
  title: string
  // JSON array in a `text` column.
  context: string
  filterAction: string
  expiresAt: number | null
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

const toServerFilter = (row: Row): ServerFilter => ({
  id: row.id,
  title: row.title,
  context: parseFilterContext(row.context),
  filterAction: FilterAction.parse(row.filterAction),
  expiresAt: row.expiresAt,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const getServerFilterById = async (
  db: Db,
  id: string
): Promise<ServerFilter | null> => {
  const row = await db
    .selectFrom('server_filters')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toServerFilter(row) : null
}

const hydrate = async (
  db: Db,
  filters: ServerFilter[]
): Promise<ActiveServerFilterRecord[]> => {
  if (filters.length === 0) return []
  const keywordRows = await selectInChunks<string, KeywordRow>(
    db,
    filters.map((filter) => filter.id),
    (chunk) =>
      db
        .selectFrom('server_filter_keywords')
        .select(KEYWORD_COLUMNS)
        .where('filterId', 'in', chunk)
        .execute()
  )

  const keywordsByFilter = groupKeywordsByFilter(keywordRows)
  return filters.map((filter) => ({
    filter,
    keywords: keywordsByFilter.get(filter.id) ?? []
  }))
}

export const createServerFilter = async (
  db: Db,
  {
    title,
    context,
    filterAction,
    expiresAt,
    keywords = []
  }: CreateServerFilterParams
): Promise<ServerFilter> => {
  const now = new Date()
  const filter: ServerFilter = {
    id: randomUUID(),
    title,
    context,
    filterAction,
    expiresAt,
    createdAt: now.getTime(),
    updatedAt: now.getTime()
  }

  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('server_filters')
      .values({
        id: filter.id,
        title: filter.title,
        context: JSON.stringify(filter.context),
        filterAction: filter.filterAction,
        expiresAt: filter.expiresAt,
        createdAt: now,
        updatedAt: now
      })
      .execute()

    await insertKeywords(
      trx,
      'server_filter_keywords',
      filter.id,
      keywords,
      now
    )
  })

  return filter
}

export const getServerFilterRecords = async (
  db: Db
): Promise<ActiveServerFilterRecord[]> => {
  // Oldest-first (creation order) so the admin list is stable as new
  // server filters are appended at the bottom.
  const rows = await db
    .selectFrom('server_filters')
    .select(COLUMNS)
    .orderBy('createdAt', 'asc')
    .execute()
  return hydrate(db, rows.map(toServerFilter))
}

export const getServerFilterRecord = async (
  db: Db,
  { id }: GetServerFilterParams
): Promise<ActiveServerFilterRecord | null> => {
  const filter = await getServerFilterById(db, id)
  if (!filter) return null
  const [record] = await hydrate(db, [filter])
  return record ?? null
}

export const getServerFilterKeywords = async (
  db: Db,
  { id }: GetServerFilterParams
): Promise<FilterKeyword[] | null> => {
  const filter = await getServerFilterById(db, id)
  if (!filter) return null
  const rows = await db
    .selectFrom('server_filter_keywords')
    .select(KEYWORD_COLUMNS)
    .where('filterId', '=', id)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toFilterKeyword)
}

export const updateServerFilter = async (
  db: Db,
  {
    id,
    title,
    context,
    filterAction,
    expiresAt,
    keywords
  }: UpdateServerFilterParams
): Promise<ServerFilter | null> => {
  const existing = await getServerFilterById(db, id)
  if (!existing) return null

  const now = new Date()
  const updated: ServerFilter = {
    ...existing,
    title: title ?? existing.title,
    context: context ?? existing.context,
    filterAction: filterAction ?? existing.filterAction,
    expiresAt: expiresAt === undefined ? existing.expiresAt : expiresAt,
    updatedAt: now.getTime()
  }

  await inTransaction(db, async (trx) => {
    await trx
      .updateTable('server_filters')
      .set({
        title: updated.title,
        context: JSON.stringify(updated.context),
        filterAction: updated.filterAction,
        expiresAt: updated.expiresAt,
        updatedAt: now
      })
      .where('id', '=', id)
      .execute()

    if (!keywords) return

    await applyKeywordChanges(trx, 'server_filter_keywords', id, keywords, now)
  })

  return updated
}

export const deleteServerFilter = async (
  db: Db,
  { id }: DeleteServerFilterParams
): Promise<ServerFilter | null> => {
  const existing = await getServerFilterById(db, id)
  if (!existing) return null
  await inTransaction(db, async (trx) => {
    await trx
      .deleteFrom('server_filter_keywords')
      .where('filterId', '=', id)
      .execute()
    await trx.deleteFrom('server_filters').where('id', '=', id).execute()
  })
  return existing
}

export const getActiveServerFilters = async (
  db: Db,
  params?: GetActiveServerFiltersParams
): Promise<ActiveServerFilterRecord[]> => {
  const context = params?.context
  // Drop expired filters in SQL — this runs on every timeline/notification
  // request (including signed-out viewers), so expired rows must never be
  // loaded. Context is a JSON column, so that filter stays in memory.
  const now = Date.now()
  const rows = await db
    .selectFrom('server_filters')
    .select(COLUMNS)
    .where((eb) =>
      eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>=', now)])
    )
    // Oldest-first, consistent with the other server-filter listings
    // (ordering is irrelevant for matching).
    .orderBy('createdAt', 'asc')
    .execute()
  const filters = rows
    .map(toServerFilter)
    .filter((filter) => !context || filter.context.includes(context))
  return hydrate(db, filters)
}

export const serverFilterQueries = {
  createServerFilter,
  getServerFilterRecords,
  getServerFilterRecord,
  getServerFilterKeywords,
  updateServerFilter,
  deleteServerFilter,
  getActiveServerFilters
}
