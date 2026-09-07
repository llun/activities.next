import { ApiRequestError, parseApiError } from '@/lib/client/http'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

import type { FitnessImportBatchResult } from './fitnessImports'

export interface FitnessProcessingState {
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStuck: boolean
  hasMapData: boolean
}

export interface StatusFitnessFileItem {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  statusId: string | null
  isPrimary: boolean
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  totalDistanceMeters: number | null
  totalDurationSeconds: number | null
  movingTimeSeconds: number | null
  elevationGainMeters: number | null
  activityType: string | null
  activityStartTime: number | null
  hasMapData: boolean
  description: string | null
  deviceManufacturer: string | null
  deviceName: string | null
  sourceUrl: string | null
  gearId: string | null
  gearName: string | null
  deviceGearId: string | null
  deviceGearName: string | null
}

export const getFitnessImportBatch = async (
  batchId: string
): Promise<FitnessImportBatchResult> => {
  const response = await fetch(
    `/api/v1/fitness/import/${encodeURIComponent(batchId)}`,
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
      'Failed to fetch fitness import batch.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  return response.json()
}

export const retryFitnessImportBatch = async (
  batchId: string,
  visibility: MastodonVisibility
): Promise<{ batchId: string; retried: number }> => {
  const response = await fetch(
    `/api/v1/fitness/import/${encodeURIComponent(batchId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ visibility })
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry fitness import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

/**
 * Returns the processing state of a status's primary fitness file so a
 * processing post can poll for progress and resolve to its finished state
 * without a manual reload. Returns null when the status has no fitness file
 * (e.g. it was deleted) so callers can stop polling.
 */
export const getFitnessProcessingState = async (
  statusId: string
): Promise<FitnessProcessingState | null> => {
  const response = await fetch(
    `/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(statusId)}`,
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
      'Failed to fetch fitness processing state.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  const data = (await response.json()) as {
    files?: Array<{
      isPrimary?: boolean
      processingStatus?: FitnessProcessingState['processingStatus']
      processingStuck?: boolean
      hasMapData?: boolean
    }>
  }

  const files = data.files ?? []
  if (files.length === 0) {
    return null
  }

  // The post surfaces its primary file; fall back to the first file when no
  // file is flagged primary (older rows default to primary anyway).
  const primary = files.find((file) => file.isPrimary) ?? files[0]

  return {
    processingStatus: primary.processingStatus ?? 'pending',
    processingStuck: Boolean(primary.processingStuck),
    hasMapData: Boolean(primary.hasMapData)
  }
}

/**
 * Lists every fitness file attached to a status (an activity can aggregate
 * several uploaded files). Returns null when the endpoint is unavailable so the
 * caller can fall back to the file metadata embedded in the status payload.
 */
export const getFitnessFilesByStatus = async (
  statusId: string
): Promise<StatusFitnessFileItem[] | null> => {
  const response = await fetch(
    `/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(statusId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) return null

  const data = (await response.json()) as {
    files?: StatusFitnessFileItem[]
  } | null
  return data && Array.isArray(data.files) ? data.files : null
}

/**
 * Fetches a short-lived Apple MapKit JS authorization token. Returns `null` when
 * the instance is not configured for the Apple map provider, or on any failure,
 * so the caller can fall back to another provider. The token is deliberately not
 * cached: MapKit re-invokes its `authorizationCallback` when the token expires.
 */
export const getAppleMapsToken = async (): Promise<string | null> => {
  try {
    const response = await fetch('/api/v1/fitness/apple-maps-token', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })
    if (!response.ok) return null

    const data = (await response.json()) as { token?: string } | null
    return typeof data?.token === 'string' ? data.token : null
  } catch {
    return null
  }
}
