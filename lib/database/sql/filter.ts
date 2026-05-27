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
  AddFilterKeywordParams,
  AddFilterStatusParams,
  CreateFilterParams,
  DeleteFilterKeywordParams,
  DeleteFilterParams,
  DeleteFilterStatusParams,
  FilterDatabase,
  GetActiveFiltersForActorParams,
  GetFilterKeywordParams,
  GetFilterKeywordsParams,
  GetFilterParams,
  GetFilterStatusParams,
  GetFilterStatusesParams,
  GetFiltersParams,
  UpdateFilterKeywordParams,
  UpdateFilterParams
} from '@/lib/types/database/operations'
import {
  Filter,
  FilterAction,
  FilterContext,
  FilterKeyword,
  FilterStatus
} from '@/lib/types/domain/filter'

type FilterRow = Omit<Filter, 'context'> & { context: string }

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

const fixFilterRow = (row: FilterRow): Filter => ({
  id: row.id,
  actorId: row.actorId,
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

const fixStatusRow = (row: FilterStatus): FilterStatus => ({
  ...row,
  createdAt: getCompatibleTime(row.createdAt)
})

const isFilterActive = (filter: Filter, now: number): boolean =>
  filter.expiresAt === null || filter.expiresAt >= now

export const FilterSQLDatabaseMixin = (database: Knex): FilterDatabase => {
  const getOwnedFilter = async (
    actorId: string,
    filterId: string
  ): Promise<Filter | null> => {
    const row = await database<FilterRow>('filters')
      .where({ id: filterId, actorId })
      .first()
    if (!row) return null
    return fixFilterRow(row)
  }

  const cascadeDeleteFilter = async (filterId: string) => {
    await database.transaction(async (trx) => {
      await trx('filter_statuses').where('filterId', filterId).delete()
      await trx('filter_keywords').where('filterId', filterId).delete()
      await trx('filters').where('id', filterId).delete()
    })
  }

  return {
    async createFilter({
      actorId,
      title,
      context,
      filterAction,
      expiresAt,
      keywords = []
    }: CreateFilterParams) {
      const now = new Date()
      const filterId = randomUUID()
      const filter: Filter = {
        id: filterId,
        actorId,
        title,
        context,
        filterAction,
        expiresAt,
        createdAt: now.getTime(),
        updatedAt: now.getTime()
      }

      await database.transaction(async (trx) => {
        await trx('filters').insert({
          id: filter.id,
          actorId: filter.actorId,
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
            await trx('filter_keywords').insert(chunk)
          }
        }
      })

      return filter
    },

    async getFilters({ actorId }: GetFiltersParams) {
      const rows = await database<FilterRow>('filters')
        .where({ actorId })
        .orderBy('createdAt', 'desc')
      const now = Date.now()
      return rows
        .map(fixFilterRow)
        .filter((filter) => isFilterActive(filter, now))
    },

    async getFilter({ actorId, id }: GetFilterParams) {
      return getOwnedFilter(actorId, id)
    },

    async updateFilter({
      actorId,
      id,
      title,
      context,
      filterAction,
      expiresAt,
      keywords
    }: UpdateFilterParams) {
      const existing = await getOwnedFilter(actorId, id)
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

      await database.transaction(async (trx) => {
        await trx('filters')
          .where({ id, actorId })
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
            await trx('filter_keywords')
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
              await trx('filter_keywords')
                .where({ id: change.id, filterId: id })
                .update(updates)
            }
            continue
          }
          if (change.keyword === undefined) continue
          await trx('filter_keywords')
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

    async deleteFilter({ actorId, id }: DeleteFilterParams) {
      const existing = await getOwnedFilter(actorId, id)
      if (!existing) return null
      await cascadeDeleteFilter(id)
      return existing
    },

    async getActiveFiltersForActor({
      actorId,
      context
    }: GetActiveFiltersForActorParams) {
      const rows = await database<FilterRow>('filters')
        .where({ actorId })
        .orderBy('createdAt', 'desc')
      const now = Date.now()
      const filters = rows
        .map(fixFilterRow)
        .filter((filter) => isFilterActive(filter, now))
        .filter((filter) => !context || filter.context.includes(context))

      if (filters.length === 0) return []

      const filterIds = filters.map((filter) => filter.id)
      const batchSize = getWhereInBatchSize(database)
      const keywordRows: FilterKeyword[] = []
      const statusRows: FilterStatus[] = []
      for (const chunk of chunkArray(filterIds, batchSize)) {
        const [keywords, statuses] = await Promise.all([
          database<FilterKeyword>('filter_keywords').whereIn('filterId', chunk),
          database<FilterStatus>('filter_statuses').whereIn('filterId', chunk)
        ])
        keywordRows.push(...keywords)
        statusRows.push(...statuses)
      }

      const keywordsByFilter = new Map<string, FilterKeyword[]>()
      for (const keyword of keywordRows) {
        const fixed = fixKeywordRow(keyword)
        const bucket = keywordsByFilter.get(fixed.filterId) ?? []
        bucket.push(fixed)
        keywordsByFilter.set(fixed.filterId, bucket)
      }

      const statusesByFilter = new Map<string, FilterStatus[]>()
      for (const status of statusRows) {
        const fixed = fixStatusRow(status)
        const bucket = statusesByFilter.get(fixed.filterId) ?? []
        bucket.push(fixed)
        statusesByFilter.set(fixed.filterId, bucket)
      }

      return filters.map((filter) => ({
        filter,
        keywords: keywordsByFilter.get(filter.id) ?? [],
        statuses: statusesByFilter.get(filter.id) ?? []
      }))
    },

    async addFilterKeyword({
      actorId,
      filterId,
      keyword,
      wholeWord
    }: AddFilterKeywordParams) {
      const filter = await getOwnedFilter(actorId, filterId)
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
      try {
        await database('filter_keywords').insert({
          ...row,
          createdAt: now,
          updatedAt: now
        })
        return row
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const existing = await database<FilterKeyword>('filter_keywords')
          .where({ filterId, keyword })
          .first()
        if (!existing) throw error
        return fixKeywordRow(existing)
      }
    },

    async getFilterKeywords({ actorId, filterId }: GetFilterKeywordsParams) {
      const filter = await getOwnedFilter(actorId, filterId)
      if (!filter) return null
      const rows = await database<FilterKeyword>('filter_keywords')
        .where('filterId', filterId)
        .orderBy('createdAt', 'asc')
      return rows.map(fixKeywordRow)
    },

    async getFilterKeyword({ actorId, id }: GetFilterKeywordParams) {
      const row = await database<FilterKeyword>('filter_keywords')
        .where('id', id)
        .first()
      if (!row) return null
      const filter = await getOwnedFilter(actorId, row.filterId)
      if (!filter) return null
      return fixKeywordRow(row)
    },

    async updateFilterKeyword({
      actorId,
      id,
      keyword,
      wholeWord
    }: UpdateFilterKeywordParams) {
      const row = await database<FilterKeyword>('filter_keywords')
        .where('id', id)
        .first()
      if (!row) return null
      const filter = await getOwnedFilter(actorId, row.filterId)
      if (!filter) return null

      const now = new Date()
      const updates: Record<string, unknown> = { updatedAt: now }
      if (keyword !== undefined) updates.keyword = keyword
      if (wholeWord !== undefined) updates.wholeWord = wholeWord

      await database('filter_keywords').where('id', id).update(updates)

      return fixKeywordRow({
        ...row,
        keyword: keyword ?? row.keyword,
        wholeWord: wholeWord ?? Boolean(row.wholeWord),
        updatedAt: now.getTime()
      })
    },

    async deleteFilterKeyword({ actorId, id }: DeleteFilterKeywordParams) {
      const row = await database<FilterKeyword>('filter_keywords')
        .where('id', id)
        .first()
      if (!row) return null
      const filter = await getOwnedFilter(actorId, row.filterId)
      if (!filter) return null

      await database('filter_keywords').where('id', id).delete()
      return fixKeywordRow(row)
    },

    async addFilterStatus({
      actorId,
      filterId,
      statusId
    }: AddFilterStatusParams) {
      const filter = await getOwnedFilter(actorId, filterId)
      if (!filter) return null

      const now = new Date()
      const row: FilterStatus = {
        id: randomUUID(),
        filterId,
        statusId,
        createdAt: now.getTime()
      }

      try {
        await database('filter_statuses').insert({
          ...row,
          createdAt: now
        })
        return row
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const existing = await database<FilterStatus>('filter_statuses')
          .where({ filterId, statusId })
          .first()
        if (!existing) throw error
        return fixStatusRow(existing)
      }
    },

    async getFilterStatuses({ actorId, filterId }: GetFilterStatusesParams) {
      const filter = await getOwnedFilter(actorId, filterId)
      if (!filter) return null
      const rows = await database<FilterStatus>('filter_statuses')
        .where('filterId', filterId)
        .orderBy('createdAt', 'asc')
      return rows.map(fixStatusRow)
    },

    async getFilterStatus({ actorId, id }: GetFilterStatusParams) {
      const row = await database<FilterStatus>('filter_statuses')
        .where('id', id)
        .first()
      if (!row) return null
      const filter = await getOwnedFilter(actorId, row.filterId)
      if (!filter) return null
      return fixStatusRow(row)
    },

    async deleteFilterStatus({ actorId, id }: DeleteFilterStatusParams) {
      const row = await database<FilterStatus>('filter_statuses')
        .where('id', id)
        .first()
      if (!row) return null
      const filter = await getOwnedFilter(actorId, row.filterId)
      if (!filter) return null

      await database('filter_statuses').where('id', id).delete()
      return fixStatusRow(row)
    }
  }
}
