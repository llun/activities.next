import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'
import type { TimelineContext } from '@/lib/types/domain/timeline'
import { isAbortError } from '@/lib/utils/isAbortError'

import { parseApiError } from './http'

export class TimelineRequestError extends Error {
  readonly status?: number
  readonly isUnauthorized: boolean

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'TimelineRequestError'
    this.status = status
    this.isUnauthorized = status === 401 || status === 403
  }
}

export interface GetTimelineParams {
  timeline: Timeline
  minStatusId?: string
  prevMinStatusId?: string
  maxStatusId?: string
  limit?: number
  includeContext?: boolean
  signal?: AbortSignal
}

export interface GetTimelineResult {
  statuses: Status[]
  context?: TimelineContext
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

const MAX_EMPTY_TIMELINE_CONTINUATIONS = 2

const getTimelinePage = async ({
  timeline,
  minStatusId,
  prevMinStatusId,
  maxStatusId,
  limit,
  includeContext,
  signal
}: GetTimelineParams): Promise<GetTimelineResult> => {
  const path = `/api/v1/timelines/${timeline}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  const resolvedMinId = minStatusId || prevMinStatusId
  if (resolvedMinId) {
    url.searchParams.append('min_id', resolvedMinId)
  }
  if (maxStatusId) {
    url.searchParams.append('max_id', maxStatusId)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    if (error instanceof TimelineRequestError) {
      throw error
    }
    const message =
      error instanceof Error ? error.message : 'Failed to fetch timeline'
    throw new TimelineRequestError(message)
  }

  if (!response.ok) {
    const message = await parseApiError(response, 'Failed to fetch timeline')
    throw new TimelineRequestError(message, response.status)
  }

  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    ...(data.context !== undefined
      ? { context: data.context as TimelineContext }
      : includeContext
        ? { context: { ancestorsById: {} } }
        : {}),
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

export const getTimeline = async ({
  timeline,
  minStatusId,
  prevMinStatusId,
  maxStatusId,
  limit,
  includeContext,
  signal
}: GetTimelineParams): Promise<GetTimelineResult> => {
  let result = await getTimelinePage({
    timeline,
    minStatusId,
    prevMinStatusId,
    maxStatusId,
    limit,
    includeContext,
    signal
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
      prevMinStatusId,
      maxStatusId: currentMaxStatusId,
      limit,
      includeContext,
      signal
    })
    currentMaxStatusId = result.nextMaxStatusId
  }

  return result
}

export interface GetHashtagTimelineParams {
  tag: string
  maxStatusId?: string
  signal?: AbortSignal
}

export interface GetHashtagTimelineResult {
  statuses: Status[]
  nextMaxStatusId: string | null
}

const getHashtagTimelinePage = async ({
  tag,
  maxStatusId,
  signal
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
    },
    signal
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
  maxStatusId,
  signal
}: GetHashtagTimelineParams): Promise<GetHashtagTimelineResult> => {
  let result = await getHashtagTimelinePage({ tag, maxStatusId, signal })
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
      maxStatusId: currentMaxStatusId,
      signal
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
  signal?: AbortSignal
}

// The list timeline does no server-side content filtering, so an empty page
// always carries a null cursor (end of list). That's unlike the home timeline,
// where filtered-out pages can still report a next cursor and need the
// empty-continuation loop in getTimeline — here a single page fetch suffices.
export const getListTimeline = async ({
  listId,
  minStatusId,
  maxStatusId,
  limit,
  signal
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
    headers: { Accept: 'application/json' },
    signal
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
  signal?: AbortSignal
}

// The owner's private collection feed (every member, owner visibility). Mirrors
// getListTimeline: a single page fetch, null cursor at the end.
export const getCollectionTimeline = async ({
  collectionId,
  minStatusId,
  maxStatusId,
  limit,
  signal
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
    headers: { Accept: 'application/json' },
    signal
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
  limit,
  signal
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
    headers: { Accept: 'application/json' },
    signal
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
