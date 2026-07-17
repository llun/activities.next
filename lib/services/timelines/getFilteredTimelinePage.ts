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
import { filterDomainBlockedStatuses } from './domainBlockFilter'
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
  // Set (with maxStatusId null) only in ascending min_id mode; the batch must
  // then come back oldest-first so the loop can walk up toward newer rows.
  minStatusId: string | null
  limit: number
}

interface GetFilteredStatusPageParams {
  database: Database
  actorId?: string
  maxStatusId?: string | null
  // When set, the page is built ascending from this lower-bound cursor (the
  // oldest rows just newer than it) and returned newest-first — Mastodon's
  // adjacent-page min_id. fetchBatch must return oldest-first batches for it.
  minStatusId?: string | null
  limit?: number
  filterContext?: FilterContext
  fetchBatch: (params: FetchFilteredStatusBatchParams) => Promise<Status[]>
}

export const getFilteredStatusPage = async ({
  database,
  actorId,
  maxStatusId = null,
  minStatusId = null,
  limit = PER_PAGE_LIMIT,
  filterContext,
  fetchBatch
}: GetFilteredStatusPageParams): Promise<FilteredTimelinePage> => {
  const pageLimit = normalizeTimelineLimit(limit)
  // min_id ascends from its cursor (oldest-first) then reverses to newest-first,
  // returning the page adjacent to the cursor; every other cursor kind backfills
  // DESC (newest-first) from max_id. min_id wins when both are present.
  const ascending = Boolean(minStatusId)
  const statuses: Status[] = []
  let iterations = 0
  let cursor = ascending ? minStatusId : maxStatusId
  let lastScannedStatusId: string | null = null
  let exhausted = false

  const filterRecords = filterContext
    ? await getActiveFilters(database, actorId, filterContext)
    : []

  // User-level domain blocks apply to every batch, so load the viewer's set
  // once per page request (indexed on actorId) and filter in memory next to
  // the block/mute filters.
  const blockedDomains = new Set(
    actorId
      ? (await database.getActorDomainBlocks({ actorId })).map(
          (block) => block.domain
        )
      : []
  )

  while (statuses.length < pageLimit && iterations < MAX_BACKFILL_ITERATIONS) {
    iterations++
    const batch = await fetchBatch({
      maxStatusId: ascending ? null : cursor,
      minStatusId: ascending ? cursor : null,
      limit: pageLimit
    })
    if (batch.length === 0) {
      exhausted = true
      break
    }

    const domainFilteredBatch = filterDomainBlockedStatuses(
      blockedDomains,
      batch
    )
    const blockFilteredBatch = await filterBlockedStatuses(
      database,
      actorId,
      domainFilteredBatch
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

  if (ascending) {
    // Ascending accumulation is oldest-first; the adjacent page is the oldest
    // `pageLimit` visible statuses, returned newest-first. rel=prev (newer)
    // continues above the newest returned; rel=next (older) below the oldest.
    visibleStatuses.reverse()
    const hasVisible = visibleStatuses.length > 0
    return {
      statuses: visibleStatuses,
      nextMaxStatusId: hasVisible
        ? visibleStatuses[visibleStatuses.length - 1].id
        : null,
      // When a filtered window empties the page but the source isn't exhausted
      // (the backfill cap was hit), keep the client paging UP past the block via
      // the last scanned id — mirroring the DESC branch's lastScannedStatusId
      // fallback, so an all-filtered stretch above the cursor can't dead-stop
      // min_id pagination and silently withhold newer posts.
      prevMinStatusId: hasVisible
        ? visibleStatuses[0].id
        : exhausted
          ? null
          : lastScannedStatusId,
      filterRecords
    }
  }

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
  sinceStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
  filterContext?: FilterContext
}

export const getFilteredTimelinePage = async ({
  database,
  timeline,
  actorId,
  minStatusId = null,
  sinceStatusId = null,
  maxStatusId = null,
  limit = PER_PAGE_LIMIT,
  filterContext
}: GetFilteredTimelinePageParams): Promise<FilteredTimelinePage> =>
  getFilteredStatusPage({
    database,
    actorId,
    maxStatusId,
    minStatusId,
    limit,
    filterContext,
    fetchBatch: async ({
      maxStatusId: descCursor,
      minStatusId: ascCursor,
      limit: batchLimit
    }) => {
      if (ascCursor !== null) {
        // min_id (adjacent-page) mode: getTimeline returns the oldest window
        // above the cursor newest-first; reverse it to oldest-first so the
        // ascending backfill loop can walk up toward newer rows.
        const rows = await database.getTimeline({
          timeline,
          actorId,
          minStatusId: ascCursor,
          maxStatusId: null,
          limit: batchLimit
        })
        return rows.reverse()
      }
      // since_id / max_id / no cursor: backfill DESC (newest-first) with
      // since_id as the lower bound.
      return database.getTimeline({
        timeline,
        actorId,
        sinceStatusId,
        maxStatusId: descCursor,
        limit: batchLimit
      })
    }
  })
