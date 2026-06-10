import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  ActiveServerFilterRecord,
  CreateServerFilterParams,
  DeleteServerFilterParams,
  GetActiveServerFiltersParams,
  GetServerFilterParams,
  ServerFilterDatabase,
  UpdateServerFilterParams
} from '@/lib/types/database/operations'
import {
  FilterAction,
  FilterContext,
  FilterKeyword,
  ServerFilter
} from '@/lib/types/domain/filter'

type ServerFilterRow = Omit<ServerFilter, 'context'> & { context: string }

const parseContext = (raw: string): FilterContext[] => {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is FilterContext =>
        typeof value === 'string' &&
        FilterContext.options.includes(value as FilterContext)
    )
  } catch {
    return []
  }
}

const fixServerFilterRow = (row: ServerFilterRow): ServerFilter => ({
  id: row.id,
  title: row.title,
  context: parseContext(row.context),
  filterAction: FilterAction.parse(row.filterAction),
  expiresAt:
    row.expiresAt !== null && row.expiresAt !== undefined
      ? Number(row.expiresAt)
      : null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const fixKeywordRow = (row: FilterKeyword): FilterKeyword => ({
  ...row,
  wholeWord: Boolean(row.wholeWord),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const ServerFilterSQLDatabaseMixin = (
  database: Knex
): ServerFilterDatabase => {
  const getServerFilterById = async (
    id: string
  ): Promise<ServerFilter | null> => {
    const row = await database<ServerFilterRow>('server_filters')
      .where({ id })
      .first()
    if (!row) return null
    return fixServerFilterRow(row)
  }

  const hydrate = async (
    filters: ServerFilter[]
  ): Promise<ActiveServerFilterRecord[]> => {
    if (filters.length === 0) return []
    const filterIds = filters.map((filter) => filter.id)
    const batchSize = getWhereInBatchSize(database)
    const keywordRows: FilterKeyword[] = []
    for (const chunk of chunkArray(filterIds, batchSize)) {
      const keywords = await database<FilterKeyword>(
        'server_filter_keywords'
      ).whereIn('filterId', chunk)
      keywordRows.push(...keywords)
    }

    const keywordsByFilter = new Map<string, FilterKeyword[]>()
    for (const keyword of keywordRows) {
      const fixed = fixKeywordRow(keyword)
      const bucket = keywordsByFilter.get(fixed.filterId) ?? []
      bucket.push(fixed)
      keywordsByFilter.set(fixed.filterId, bucket)
    }

    return filters.map((filter) => ({
      filter,
      keywords: keywordsByFilter.get(filter.id) ?? []
    }))
  }

  return {
    async createServerFilter({
      title,
      context,
      filterAction,
      expiresAt,
      keywords = []
    }: CreateServerFilterParams) {
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

      await database.transaction(async (trx) => {
        await trx('server_filters').insert({
          id: filter.id,
          title: filter.title,
          context: JSON.stringify(filter.context),
          filterAction: filter.filterAction,
          expiresAt: filter.expiresAt,
          createdAt: now,
          updatedAt: now
        })

        if (keywords.length > 0) {
          const rows = keywords.map((keyword) => ({
            id: randomUUID(),
            filterId: filter.id,
            keyword: keyword.keyword,
            wholeWord: Boolean(keyword.wholeWord),
            createdAt: now,
            updatedAt: now
          }))
          const batchSize = getInsertBatchSize(trx, rows[0])
          for (const chunk of chunkArray(rows, batchSize)) {
            await trx('server_filter_keywords')
              .insert(chunk)
              .onConflict(['filterId', 'keyword'])
              .ignore()
          }
        }
      })

      return filter
    },

    async getServerFilterRecords() {
      // Oldest-first (creation order) so the admin list is stable as new
      // server filters are appended at the bottom.
      const rows = await database<ServerFilterRow>('server_filters').orderBy(
        'createdAt',
        'asc'
      )
      return hydrate(rows.map(fixServerFilterRow))
    },

    async getServerFilter({ id }: GetServerFilterParams) {
      return getServerFilterById(id)
    },

    async getServerFilterRecord({ id }: GetServerFilterParams) {
      const filter = await getServerFilterById(id)
      if (!filter) return null
      const [record] = await hydrate([filter])
      return record ?? null
    },

    async getServerFilterKeywords({ id }: GetServerFilterParams) {
      const filter = await getServerFilterById(id)
      if (!filter) return null
      const rows = await database<FilterKeyword>('server_filter_keywords')
        .where('filterId', id)
        .orderBy('createdAt', 'asc')
      return rows.map(fixKeywordRow)
    },

    async updateServerFilter({
      id,
      title,
      context,
      filterAction,
      expiresAt,
      keywords
    }: UpdateServerFilterParams) {
      const existing = await getServerFilterById(id)
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

      await database.transaction(async (trx) => {
        await trx('server_filters')
          .where({ id })
          .update({
            title: updated.title,
            context: JSON.stringify(updated.context),
            filterAction: updated.filterAction,
            expiresAt: updated.expiresAt,
            updatedAt: now
          })

        if (!keywords) return

        for (const change of keywords) {
          if (change._destroy && change.id) {
            await trx('server_filter_keywords')
              .where({ id: change.id, filterId: id })
              .delete()
            continue
          }
          if (change.id) {
            const updates: Record<string, unknown> = { updatedAt: now }
            if (change.keyword !== undefined) updates.keyword = change.keyword
            if (change.wholeWord !== undefined)
              updates.wholeWord = change.wholeWord
            if (Object.keys(updates).length > 1) {
              try {
                await trx.transaction((sp) =>
                  sp('server_filter_keywords')
                    .where({ id: change.id, filterId: id })
                    .update(updates)
                )
              } catch (error) {
                if (!isUniqueConstraintError(error)) throw error
                // Duplicate keyword text — skip silently via savepoint rollback
              }
            }
            continue
          }
          if (change.keyword === undefined) continue
          await trx('server_filter_keywords')
            .insert({
              id: randomUUID(),
              filterId: id,
              keyword: change.keyword,
              wholeWord: Boolean(change.wholeWord),
              createdAt: now,
              updatedAt: now
            })
            .onConflict(['filterId', 'keyword'])
            .ignore()
        }
      })

      return updated
    },

    async deleteServerFilter({ id }: DeleteServerFilterParams) {
      const existing = await getServerFilterById(id)
      if (!existing) return null
      await database.transaction(async (trx) => {
        await trx('server_filter_keywords').where('filterId', id).delete()
        await trx('server_filters').where('id', id).delete()
      })
      return existing
    },

    async getActiveServerFilters(params?: GetActiveServerFiltersParams) {
      const context = params?.context
      // Drop expired filters in SQL — this runs on every timeline/notification
      // request (including signed-out viewers), so expired rows must never be
      // loaded. Context is a JSON column, so that filter stays in memory.
      const rows = await database<ServerFilterRow>('server_filters')
        .where((builder) => {
          builder.whereNull('expiresAt').orWhere('expiresAt', '>=', Date.now())
        })
        .orderBy('createdAt', 'desc')
      const filters = rows
        .map(fixServerFilterRow)
        .filter((filter) => !context || filter.context.includes(context))
      return hydrate(filters)
    }
  }
}
