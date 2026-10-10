// Parameter and result types of the filter domain (per-actor, Mastodon-style
// content filters with keywords and status filters). lib/types/database/
// operations.ts re-exports them, so existing imports keep working.
import type {
  Filter,
  FilterAction,
  FilterContext,
  FilterKeyword,
  FilterStatus
} from '@/lib/types/domain/filter'

export type CreateFilterKeywordInput = {
  keyword: string
  wholeWord?: boolean
}

export type UpdateFilterKeywordInput = {
  id?: string
  keyword?: string
  wholeWord?: boolean
  _destroy?: boolean
}

export type CreateFilterParams = {
  actorId: string
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  expiresAt: number | null
  keywords?: CreateFilterKeywordInput[]
}

export type GetFilterParams = {
  actorId: string
  id: string
}

export type UpdateFilterParams = {
  actorId: string
  id: string
  title?: string
  context?: FilterContext[]
  filterAction?: FilterAction
  expiresAt?: number | null
  keywords?: UpdateFilterKeywordInput[]
}

export type DeleteFilterParams = {
  actorId: string
  id: string
}

export type GetActiveFiltersForActorParams = {
  actorId: string
  context?: FilterContext
}

export type GetFilterRecordsForActorParams = {
  actorId: string
}

export type ActiveFilterRecord = {
  filter: Filter
  keywords: FilterKeyword[]
  statuses: FilterStatus[]
}

export type AddFilterKeywordParams = {
  actorId: string
  filterId: string
  keyword: string
  wholeWord?: boolean
}

export type GetFilterKeywordsParams = {
  actorId: string
  filterId: string
}

export type GetFilterKeywordParams = {
  actorId: string
  id: string
}

export type UpdateFilterKeywordParams = {
  actorId: string
  id: string
  keyword?: string
  wholeWord?: boolean
}

export type DeleteFilterKeywordParams = {
  actorId: string
  id: string
}

export type AddFilterStatusParams = {
  actorId: string
  filterId: string
  statusId: string
}

export type GetFilterStatusesParams = {
  actorId: string
  filterId: string
}

export type GetFilterStatusParams = {
  actorId: string
  id: string
}

export type DeleteFilterStatusParams = {
  actorId: string
  id: string
}

export interface FilterDatabase {
  createFilter(params: CreateFilterParams): Promise<Filter>
  getFilter(params: GetFilterParams): Promise<Filter | null>
  updateFilter(params: UpdateFilterParams): Promise<Filter | null>
  deleteFilter(params: DeleteFilterParams): Promise<Filter | null>
  getActiveFiltersForActor(
    params: GetActiveFiltersForActorParams
  ): Promise<ActiveFilterRecord[]>
  // Like getActiveFiltersForActor but returns ALL of the actor's filters,
  // including expired ones, so the management UI can list expired filters with
  // an "Expired" badge and let the user reactivate them.
  getFilterRecordsForActor(
    params: GetFilterRecordsForActorParams
  ): Promise<ActiveFilterRecord[]>
  addFilterKeyword(
    params: AddFilterKeywordParams
  ): Promise<FilterKeyword | null>
  getFilterKeywords(
    params: GetFilterKeywordsParams
  ): Promise<FilterKeyword[] | null>
  getFilterKeyword(
    params: GetFilterKeywordParams
  ): Promise<FilterKeyword | null>
  updateFilterKeyword(
    params: UpdateFilterKeywordParams
  ): Promise<FilterKeyword | null | 'duplicate'>
  deleteFilterKeyword(
    params: DeleteFilterKeywordParams
  ): Promise<FilterKeyword | null>
  addFilterStatus(params: AddFilterStatusParams): Promise<FilterStatus | null>
  getFilterStatuses(
    params: GetFilterStatusesParams
  ): Promise<FilterStatus[] | null>
  getFilterStatus(params: GetFilterStatusParams): Promise<FilterStatus | null>
  deleteFilterStatus(
    params: DeleteFilterStatusParams
  ): Promise<FilterStatus | null>
}
