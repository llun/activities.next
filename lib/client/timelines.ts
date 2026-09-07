import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'

export interface GetTimelineParams {
  timeline: Timeline
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

export interface GetTimelineResult {
  statuses: Status[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

const MAX_EMPTY_TIMELINE_CONTINUATIONS = 2

const getTimelinePage = async ({
  timeline,
  minStatusId,
  maxStatusId,
  limit
}: GetTimelineParams): Promise<GetTimelineResult> => {
  const path = `/api/v1/timelines/${timeline}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (minStatusId) {
    url.searchParams.append('min_id', minStatusId)
  }
  if (maxStatusId) {
    url.searchParams.append('max_id', maxStatusId)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

export const getTimeline = async ({
  timeline,
  minStatusId,
  maxStatusId,
  limit
}: GetTimelineParams): Promise<GetTimelineResult> => {
  let result = await getTimelinePage({
    timeline,
    minStatusId,
    maxStatusId,
    limit
  })
  let currentMaxStatusId = result.nextMaxStatusId
  let continuations = 0

  while (
    result.statuses.length === 0 &&
    currentMaxStatusId &&
    continuations < MAX_EMPTY_TIMELINE_CONTINUATIONS
  ) {
    continuations++
    result = await getTimelinePage({
      timeline,
      minStatusId,
      maxStatusId: currentMaxStatusId,
      limit
    })
    currentMaxStatusId = result.nextMaxStatusId
  }

  return result
}

export interface GetHashtagTimelineParams {
  tag: string
  maxStatusId?: string
}

export interface GetHashtagTimelineResult {
  statuses: Status[]
  nextMaxStatusId: string | null
}

const getHashtagTimelinePage = async ({
  tag,
  maxStatusId
}: GetHashtagTimelineParams): Promise<GetHashtagTimelineResult> => {
  const path = `/api/v1/tags/${encodeURIComponent(tag)}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (maxStatusId) {
    url.searchParams.append('max_id', maxStatusId)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null
  }
}

export const getHashtagTimeline = async ({
  tag,
  maxStatusId
}: GetHashtagTimelineParams): Promise<GetHashtagTimelineResult> => {
  let result = await getHashtagTimelinePage({ tag, maxStatusId })
  let currentMaxStatusId = result.nextMaxStatusId
  let continuations = 0

  while (
    result.statuses.length === 0 &&
    currentMaxStatusId &&
    continuations < MAX_EMPTY_TIMELINE_CONTINUATIONS
  ) {
    continuations++
    result = await getHashtagTimelinePage({
      tag,
      maxStatusId: currentMaxStatusId
    })
    currentMaxStatusId = result.nextMaxStatusId
  }

  return result
}

export interface GetListTimelineParams {
  listId: string
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

// The list timeline does no server-side content filtering, so an empty page
// always carries a null cursor (end of list). That's unlike the home timeline,
// where filtered-out pages can still report a next cursor and need the
// empty-continuation loop in getTimeline — here a single page fetch suffices.
export const getListTimeline = async ({
  listId,
  minStatusId,
  maxStatusId,
  limit
}: GetListTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/timelines/list/${encodeURIComponent(
      listId
    )}?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

export interface GetCollectionTimelineParams {
  collectionId: string
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

// The owner's private collection feed (every member, owner visibility). Mirrors
// getListTimeline: a single page fetch, null cursor at the end.
export const getCollectionTimeline = async ({
  collectionId,
  minStatusId,
  maxStatusId,
  limit
}: GetCollectionTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/timelines/collection/${encodeURIComponent(
      collectionId
    )}?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

// The public, consent-gated projection of a collection's feed (approved members
// ∩ public posts). Unauthenticated-readable; used for the owner's "Public
// preview" toggle and the public collection page. Requests the internal format
// so the same <Posts> path renders it.
export const getCollectionFeed = async ({
  collectionId,
  minStatusId,
  maxStatusId,
  limit
}: GetCollectionTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/collections/${encodeURIComponent(
      collectionId
    )}/feed?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}
