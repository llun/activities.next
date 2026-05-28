import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { Database } from '@/lib/database/types'
import {
  dropHideMatchesFromStatuses,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { Timeline } from '@/lib/services/timelines/types'
import { ActiveFilterRecord } from '@/lib/types/database/operations'
import { FilterContext } from '@/lib/types/domain/filter'
import { Status } from '@/lib/types/domain/status'

import { filterBlockedStatuses } from './blockFilter'
import { filterMutedStatuses } from './muteFilter'

export const MAX_TIMELINE_LIMIT = 80
export const MAX_BACKFILL_ITERATIONS = 5

export interface FilteredTimelinePage {
  statuses: Status[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
  filterRecords?: ActiveFilterRecord[]
}

export const normalizeTimelineLimit = (limit?: number | null) =>
  Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, MAX_TIMELINE_LIMIT)
    : PER_PAGE_LIMIT

interface FetchFilteredStatusBatchParams {
  maxStatusId: string | null
  limit: number
}

interface GetFilteredStatusPageParams {
  database: Database
  actorId?: string
  maxStatusId?: string | null
  limit?: number
  filterContext?: FilterContext
  fetchBatch: (params: FetchFilteredStatusBatchParams) => Promise<Status[]>
}

export const getFilteredStatusPage = async ({
  database,
  actorId,
  maxStatusId = null,
  limit = PER_PAGE_LIMIT,
  filterContext,
  fetchBatch
}: GetFilteredStatusPageParams): Promise<FilteredTimelinePage> => {
  const pageLimit = normalizeTimelineLimit(limit)
  const statuses: Status[] = []
  let iterations = 0
  let cursor = maxStatusId
  let lastScannedStatusId: string | null = null
  let exhausted = false

  const filterRecords = filterContext
    ? await getActiveFilters(database, actorId, filterContext)
    : []

  while (statuses.length < pageLimit && iterations < MAX_BACKFILL_ITERATIONS) {
    iterations++
    const batch = await fetchBatch({
      maxStatusId: cursor,
      limit: pageLimit
    })
    if (batch.length === 0) {
      exhausted = true
      break
    }

    const blockFilteredBatch = await filterBlockedStatuses(
      database,
      actorId,
      batch
    )
    const muteFilteredBatch = await filterMutedStatuses(
      database,
      actorId,
      blockFilteredBatch
    )
    const filteredBatch =
      filterRecords.length > 0
        ? dropHideMatchesFromStatuses(muteFilteredBatch, filterRecords)
        : muteFilteredBatch
    statuses.push(...filteredBatch)
    cursor = batch[batch.length - 1].id
    lastScannedStatusId = cursor

    if (batch.length < pageLimit) {
      exhausted = true
      break
    }
  }

  const visibleStatuses = statuses.slice(0, pageLimit)
  const lastVisibleStatusId =
    visibleStatuses.length > 0
      ? visibleStatuses[visibleStatuses.length - 1].id
      : null
  const hasBufferedVisibleStatuses = statuses.length > pageLimit
  let nextMaxStatusId: string | null = null

  if (
    hasBufferedVisibleStatuses ||
    (visibleStatuses.length === pageLimit && !exhausted)
  ) {
    nextMaxStatusId = hasBufferedVisibleStatuses
      ? lastVisibleStatusId
      : (lastScannedStatusId ?? lastVisibleStatusId)
  } else if (!exhausted) {
    nextMaxStatusId = lastScannedStatusId
  }

  return {
    statuses: visibleStatuses,
    nextMaxStatusId,
    prevMinStatusId: visibleStatuses.length > 0 ? visibleStatuses[0].id : null,
    filterRecords
  }
}

interface GetFilteredTimelinePageParams {
  database: Database
  timeline: Timeline
  actorId: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
  filterContext?: FilterContext
}

export const getFilteredTimelinePage = async ({
  database,
  timeline,
  actorId,
  minStatusId = null,
  maxStatusId = null,
  limit = PER_PAGE_LIMIT,
  filterContext
}: GetFilteredTimelinePageParams): Promise<FilteredTimelinePage> =>
  getFilteredStatusPage({
    database,
    actorId,
    maxStatusId,
    limit,
    filterContext,
    fetchBatch: ({ maxStatusId: cursor, limit: batchLimit }) =>
      database.getTimeline({
        timeline,
        actorId,
        minStatusId,
        maxStatusId: cursor,
        limit: batchLimit
      })
  })
