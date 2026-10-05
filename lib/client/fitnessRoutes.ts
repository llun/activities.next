import { z } from 'zod'

import type { FitnessActivitySummary } from '@/lib/fitness/calendar/types'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { ApiRequestError, parseApiError } from './http'

export interface FitnessRouteSample {
  lat: number
  lng: number
  elapsedSeconds: number
  timestamp?: number
  altitude?: number
  heartRate?: number
  speed?: number
  isHiddenByPrivacy?: boolean
}

export interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

export interface FitnessRouteDataResponse {
  samples: FitnessRouteSample[]
  segments?: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
}

/**
 * Fetches the parsed route samples and metric time series (altitude / speed /
 * power / heart rate) for a fitness file, used to draw the activity map and the
 * Analysis charts. Throws when the request fails or the payload is malformed so
 * the caller can fall back to the static map preview.
 */
export const getFitnessRouteData = async (
  fitnessFileId: string
): Promise<FitnessRouteDataResponse> => {
  const response = await fetch(
    `/api/v1/fitness-files/${encodeURIComponent(fitnessFileId)}/route-data`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to load route data.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  const data = (await response.json()) as FitnessRouteDataResponse | null
  // Throw (rather than return an empty fallback) on a malformed/null payload so
  // the caller's catch can surface the error state; guard the null case first to
  // avoid a raw TypeError when reading `.samples`.
  if (!data || !Array.isArray(data.samples)) {
    throw new Error('Route data response is invalid')
  }

  return data
}

/**
 * Retries every failed/stuck fitness import for the current actor in one call,
 * so the owner doesn't have to retry each post individually.
 */
export const retryAllFitnessImports = async (): Promise<{
  retried: number
  batches: number
  failedBatches: number
}> => {
  const response = await fetch('/api/v1/fitness/retry-failed', {
    method: 'POST'
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry fitness imports.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

const FitnessActivitySummariesSchema = z.array(
  z.object({
    activityType: z.string().nullable(),
    count: z.number(),
    totalDistanceMeters: z.number(),
    totalDurationSeconds: z.number(),
    totalElevationGainMeters: z.number()
  })
)

export interface GetFitnessSummaryParams {
  actorId: string
  /** Inclusive `YYYY-MM-DD` key in `timeZone`. */
  from: string
  /** Inclusive `YYYY-MM-DD` key in `timeZone`. */
  to: string
  /** IANA zone the range is read in. */
  timeZone: string
  signal?: AbortSignal
}

/**
 * Per-activity-type totals for the viewer-local range. `activityType` is
 * `null` for activities without a type. A non-OK response throws an
 * `ApiRequestError` and a malformed body throws: an error is never an empty
 * summary.
 */
export const getFitnessSummary = async ({
  actorId,
  from,
  to,
  timeZone,
  signal
}: GetFitnessSummaryParams): Promise<FitnessActivitySummary[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-summary`
  )
  url.searchParams.append('from', from)
  url.searchParams.append('to', to)
  url.searchParams.append('time_zone', timeZone)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  })
  if (!response.ok) {
    throw new ApiRequestError(
      await parseApiError(response, 'Failed to fetch fitness summary.'),
      response.status
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    // An abort that lands while the body streams is the caller's cancellation,
    // not a malformed body.
    if (signal?.aborted) throw error
    throw new Error('Fitness summary response is invalid', { cause: error })
  }
  const parsed = FitnessActivitySummariesSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Fitness summary response is invalid')
  }
  return parsed.data
}

export const deleteFitnessFile = async (id: string): Promise<void> => {
  const response = await fetch(`/api/v1/accounts/fitness-files/${id}`, {
    method: 'DELETE'
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to delete fitness file.'
    )
    throw new Error(errorDetails)
  }
}
