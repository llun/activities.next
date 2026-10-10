// Parameter and result types of the server filter domain (instance-wide,
// admin-authored content filters). lib/types/database/operations.ts re-exports
// them, so existing imports keep working.
import type {
  CreateFilterKeywordInput,
  UpdateFilterKeywordInput
} from '@/lib/database/domains/filter/types'
import type {
  FilterAction,
  FilterContext,
  FilterKeyword,
  ServerFilter
} from '@/lib/types/domain/filter'

export type CreateServerFilterParams = {
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  expiresAt: number | null
  keywords?: CreateFilterKeywordInput[]
}

export type GetServerFilterParams = {
  id: string
}

export type UpdateServerFilterParams = {
  id: string
  title?: string
  context?: FilterContext[]
  filterAction?: FilterAction
  expiresAt?: number | null
  keywords?: UpdateFilterKeywordInput[]
}

export type DeleteServerFilterParams = {
  id: string
}

export type GetActiveServerFiltersParams = {
  context?: FilterContext
}

export type ActiveServerFilterRecord = {
  filter: ServerFilter
  keywords: FilterKeyword[]
}

export interface ServerFilterDatabase {
  createServerFilter(params: CreateServerFilterParams): Promise<ServerFilter>
  // All server filters (including expired), hydrated with keywords, for the
  // admin management UI.
  getServerFilterRecords(): Promise<ActiveServerFilterRecord[]>
  // A single server filter (including expired) hydrated with keywords, for the
  // admin detail endpoint.
  getServerFilterRecord(
    params: GetServerFilterParams
  ): Promise<ActiveServerFilterRecord | null>
  getServerFilterKeywords(
    params: GetServerFilterParams
  ): Promise<FilterKeyword[] | null>
  updateServerFilter(
    params: UpdateServerFilterParams
  ): Promise<ServerFilter | null>
  deleteServerFilter(
    params: DeleteServerFilterParams
  ): Promise<ServerFilter | null>
  // Only active (non-expired) server filters, hydrated with keywords, for
  // merging into clients' filter lists and applying to timelines.
  getActiveServerFilters(
    params?: GetActiveServerFiltersParams
  ): Promise<ActiveServerFilterRecord[]>
}
