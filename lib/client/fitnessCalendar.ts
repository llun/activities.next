// `toIdPathSegment` is the ONLY id transformation this module performs, and it
// only ever fires for a raw AP URI headed into a URL path segment. Every
// id-accepting route resolves a publicId, a legacy colon/`apurl_` id, or a raw
// URI, so re-encoding a client id here can only corrupt it — `urlToId` reads a
// UUIDv7 publicId as a bare host and hands back `<uuid>:`, which nothing can
// resolve. Ids in query params and JSON bodies go out verbatim.
import { z } from 'zod'

import type {
  FitnessCalendarDay,
  FitnessDayActivitiesPage
} from '@/lib/fitness/calendar/types'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { ApiRequestError, parseApiError } from './http'

const FitnessCalendarDaysSchema = z.array(
  z.object({
    date: z.string(),
    count: z.number(),
    totalDistanceMeters: z.number(),
    totalDurationSeconds: z.number(),
    totalElevationGainMeters: z.number()
  })
)

const FitnessDayActivitiesPageSchema = z.object({
  date: z.string(),
  timeZone: z.string(),
  activities: z.array(
    z.object({
      id: z.string(),
      activityType: z.string().nullable(),
      startTime: z.number(),
      totalDistanceMeters: z.number().nullable(),
      totalDurationSeconds: z.number().nullable(),
      elevationGainMeters: z.number().nullable(),
      title: z.string().nullable(),
      statusPath: z.string().nullable()
    })
  ),
  hasMore: z.boolean(),
  nextOffset: z.number()
})

const fetchFitnessCalendarJson = async (
  url: URL,
  signal: AbortSignal | undefined,
  fallbackError: string,
  invalidError: string
): Promise<unknown> => {
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok) {
    throw new ApiRequestError(
      await parseApiError(response, fallbackError),
      response.status
    )
  }
  try {
    return await response.json()
  } catch (error) {
    // An abort that lands while the body streams is the caller's cancellation,
    // not a malformed body.
    if (signal?.aborted) throw error
    throw new Error(invalidError, { cause: error })
  }
}

/**
 * Per-day totals for the viewer-local range `from`..`to` (inclusive
 * `YYYY-MM-DD` keys) in `timeZone`. A non-OK response throws an
 * `ApiRequestError` and a malformed body throws: an error is never an empty
 * range.
 */
export const getFitnessCalendarData = async ({
  actorId,
  from,
  to,
  timeZone,
  activityType,
  signal
}: {
  actorId: string
  from: string
  to: string
  timeZone: string
  activityType?: string
  signal?: AbortSignal
}): Promise<FitnessCalendarDay[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-calendar`
  )
  url.searchParams.append('from', from)
  url.searchParams.append('to', to)
  url.searchParams.append('time_zone', timeZone)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  const body = await fetchFitnessCalendarJson(
    url,
    signal,
    'Failed to fetch fitness calendar.',
    'Fitness calendar response is invalid'
  )
  const parsed = FitnessCalendarDaysSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Fitness calendar response is invalid')
  }
  return parsed.data
}

/**
 * One page of the countable activities on the local day `date` in `timeZone`.
 * Pass the previous page's `nextOffset` as `offset` to load more.
 */
export const getFitnessCalendarDayActivities = async ({
  actorId,
  date,
  timeZone,
  limit,
  offset,
  signal
}: {
  actorId: string
  date: string
  timeZone: string
  limit?: number
  offset?: number
  signal?: AbortSignal
}): Promise<FitnessDayActivitiesPage> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-calendar/day`
  )
  url.searchParams.append('date', date)
  url.searchParams.append('time_zone', timeZone)
  if (limit !== undefined) {
    url.searchParams.append('limit', `${limit}`)
  }
  if (offset !== undefined) {
    url.searchParams.append('offset', `${offset}`)
  }
  const body = await fetchFitnessCalendarJson(
    url,
    signal,
    'Failed to fetch fitness day activities.',
    'Fitness day activities response is invalid'
  )
  const parsed = FitnessDayActivitiesPageSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Fitness day activities response is invalid')
  }
  return parsed.data
}
