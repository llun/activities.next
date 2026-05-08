import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import { Status } from '@/lib/types/domain/status'

import { filterBlockedStatuses } from './blockFilter'

export const MAX_TIMELINE_LIMIT = 80
export const MAX_BACKFILL_ITERATIONS = 5

export interface FilteredTimelinePage {
  statuses: Status[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

interface GetFilteredTimelinePageParams {
  database: Database
  timeline: Timeline
  actorId: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
}

export const normalizeTimelineLimit = (limit?: number | null) =>
  Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, MAX_TIMELINE_LIMIT)
    : PER_PAGE_LIMIT

export const getFilteredTimelinePage = async ({
  database,
  timeline,
  actorId,
  minStatusId = null,
  maxStatusId = null,
  limit = PER_PAGE_LIMIT
}: GetFilteredTimelinePageParams): Promise<FilteredTimelinePage> => {
  const pageLimit = normalizeTimelineLimit(limit)
  const statuses: Status[] = []
  let iterations = 0
  let cursor = maxStatusId
  let lastScannedStatusId: string | null = null
  let exhausted = false

  while (statuses.length < pageLimit && iterations < MAX_BACKFILL_ITERATIONS) {
    iterations++
    const batch = await database.getTimeline({
      timeline,
      actorId,
      minStatusId,
      maxStatusId: cursor,
      limit: pageLimit
    })
    if (batch.length === 0) {
      exhausted = true
      break
    }

    const filteredBatch = await filterBlockedStatuses(database, actorId, batch)
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
  const nextMaxStatusId =
    visibleStatuses.length === pageLimit && !exhausted
      ? lastVisibleStatusId
      : !exhausted
        ? lastScannedStatusId
        : null

  return {
    statuses: visibleStatuses,
    nextMaxStatusId,
    prevMinStatusId: visibleStatuses.length > 0 ? visibleStatuses[0].id : null
  }
}
