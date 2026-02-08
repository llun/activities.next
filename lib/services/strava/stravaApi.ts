import {
  StravaDetailedActivity,
  StravaTokenResponse
} from '@/lib/types/domain/fitnessActivity'
import { logger } from '@/lib/utils/logger'

// Re-export types for convenience
export type { StravaTokenResponse, StravaDetailedActivity }

const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

/**
 * Fetch a detailed activity from Strava API
 */
export async function getActivity(
  accessToken: string,
  activityId: number
): Promise<StravaDetailedActivity | null> {
  const url = `${STRAVA_API_BASE}/activities/${activityId}`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.status === 404) {
      logger.warn({
        message: 'Strava activity not found',
        activityId
      })
      return null
    }

    if (response.status === 401) {
      logger.warn({
        message: 'Strava access token expired or invalid',
        activityId
      })
      throw new Error('Strava access token expired')
    }

    if (!response.ok) {
      const error = await response.text()
      logger.error({
        message: 'Failed to fetch Strava activity',
        status: response.status,
        error,
        activityId
      })
      throw new Error(`Failed to fetch activity: ${response.status}`)
    }

    const activity: StravaDetailedActivity = await response.json()
    return activity
  } catch (error) {
    logger.error({
      message: 'Error fetching Strava activity',
      error,
      activityId
    })
    throw error
  }
}

/**
 * Strava activity stream types
 */
export type StreamType =
  | 'time'
  | 'distance'
  | 'latlng'
  | 'altitude'
  | 'velocity_smooth'
  | 'heartrate'
  | 'cadence'
  | 'watts'
  | 'temp'
  | 'moving'
  | 'grade_smooth'

export interface StreamData {
  type: StreamType
  data: number[] | [number, number][]
  series_type: string
  original_size: number
  resolution: string
}

export interface StreamSet {
  [key: string]: StreamData
}

/**
 * Fetch activity streams (GPS data, heart rate, etc.)
 */
export async function getActivityStreams(
  accessToken: string,
  activityId: number,
  keys: StreamType[] = ['latlng', 'altitude', 'heartrate', 'velocity_smooth']
): Promise<StreamSet | null> {
  const url = new URL(`${STRAVA_API_BASE}/activities/${activityId}/streams`)
  url.searchParams.set('keys', keys.join(','))
  url.searchParams.set('key_by_type', 'true')

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.status === 404) {
      // Activity might not have streams (indoor, manual, etc.)
      return null
    }

    if (response.status === 401) {
      throw new Error('Strava access token expired')
    }

    if (!response.ok) {
      const error = await response.text()
      logger.error({
        message: 'Failed to fetch Strava activity streams',
        status: response.status,
        error,
        activityId
      })
      return null
    }

    const streams: StreamSet = await response.json()
    return streams
  } catch (error) {
    logger.error({
      message: 'Error fetching Strava activity streams',
      error,
      activityId
    })
    return null
  }
}

/**
 * Refresh an expired access token using the refresh token
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<StravaTokenResponse> {
  const formData = new URLSearchParams()
  formData.append('client_id', clientId)
  formData.append('client_secret', clientSecret)
  formData.append('grant_type', 'refresh_token')
  formData.append('refresh_token', refreshToken)

  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error({
      message: 'Failed to refresh Strava access token',
      status: response.status,
      error
    })
    throw new Error(`Failed to refresh token: ${response.status}`)
  }

  const tokens: StravaTokenResponse = await response.json()
  return tokens
}

/**
 * Check if an access token is expired (with 5 minute buffer)
 */
export function isTokenExpired(expiresAt: number): boolean {
  const now = Date.now()
  const expiryWithBuffer = expiresAt - 5 * 60 * 1000 // 5 minutes before expiry
  return now >= expiryWithBuffer
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(params: {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
  clientId: string
  clientSecret: string
  onTokenRefresh?: (tokens: StravaTokenResponse) => Promise<void>
}): Promise<string> {
  const {
    accessToken,
    refreshToken,
    tokenExpiresAt,
    clientId,
    clientSecret,
    onTokenRefresh
  } = params

  if (!isTokenExpired(tokenExpiresAt)) {
    return accessToken
  }

  // Token is expired, refresh it
  logger.info({
    message: 'Refreshing expired Strava access token'
  })

  const newTokens = await refreshAccessToken(
    clientId,
    clientSecret,
    refreshToken
  )

  // Notify caller of new tokens so they can be persisted
  if (onTokenRefresh) {
    await onTokenRefresh(newTokens)
  }

  return newTokens.access_token
}
