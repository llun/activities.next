import { Database } from '@/lib/database/types'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'
import {
  formatFitnessDistance,
  formatFitnessDuration,
  formatFitnessElevation
} from '@/lib/utils/fitness'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'

const STRAVA_API_BASE = 'https://www.strava.com/api/v3'
const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_TOKEN_REFRESH_BUFFER_MS = 60_000

type StravaActivityVisibility =
  | 'everyone'
  | 'followers_only'
  | 'only_me'
  | string

interface StravaPhotoUrls {
  [size: string]: string | null | undefined
}

interface StravaPhotoPrimary {
  unique_id?: string | number
  urls?: StravaPhotoUrls | null
}

interface StravaActivityPhotos {
  count?: number
  primary?: StravaPhotoPrimary | null
}

export interface StravaActivity {
  id: number
  name?: string | null
  description?: string | null
  distance?: number
  moving_time?: number
  elapsed_time?: number
  total_elevation_gain?: number
  start_date?: string
  sport_type?: string | null
  type?: string | null
  visibility?: StravaActivityVisibility | null
  photos?: StravaActivityPhotos | null
}

interface StravaTokenRefreshResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface StravaActivityPhotoApiResponse {
  unique_id?: string | number
  urls?: StravaPhotoUrls | null
}

export interface StravaActivityPhoto {
  id?: string
  url: string
}

const getStravaErrorDetail = async (response: Response) => {
  const body = await response.text().catch(() => '')
  if (!body) {
    return response.statusText || 'Unknown Strava error'
  }

  try {
    const parsed = JSON.parse(body) as {
      message?: string
      errors?: Array<{ message?: string }>
    }

    if (parsed.message) {
      return parsed.message
    }

    const firstError = parsed.errors?.find((error) => Boolean(error.message))
    if (firstError?.message) {
      return firstError.message
    }
  } catch {
    // Keep raw text below.
  }

  return body
}

const getStravaAuthHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`
})

const pickBestPhotoUrl = (urls?: StravaPhotoUrls | null) => {
  if (!urls) return null

  const entries = Object.entries(urls).filter(
    (entry): entry is [string, string] => {
      return typeof entry[1] === 'string' && entry[1].trim().length > 0
    }
  )
  if (entries.length === 0) {
    return null
  }

  const numericEntries = entries
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([firstKey], [secondKey]) => Number(secondKey) - Number(firstKey))

  if (numericEntries.length > 0) {
    return numericEntries[0][1]
  }

  return entries[0][1]
}

const toPhotoId = (value: unknown) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return undefined
}

const getActivityLabelAndEmoji = (activity: StravaActivity) => {
  const rawType = (activity.sport_type || activity.type || '').trim()
  const normalized = rawType.toLowerCase()

  if (normalized.includes('run')) {
    return { label: rawType || 'Run', emoji: '🏃' }
  }
  if (normalized.includes('walk')) {
    return { label: rawType || 'Walk', emoji: '🚶' }
  }
  if (normalized.includes('hike')) {
    return { label: rawType || 'Hike', emoji: '🥾' }
  }
  if (
    normalized.includes('ride') ||
    normalized.includes('cycle') ||
    normalized.includes('bike')
  ) {
    return { label: rawType || 'Ride', emoji: '🚴' }
  }
  if (normalized.includes('swim')) {
    return { label: rawType || 'Swim', emoji: '🏊' }
  }
  if (rawType.length > 0) {
    return { label: rawType, emoji: '🏋️' }
  }
  return { label: 'Workout', emoji: '🏋️' }
}

const getExportFileTypeFromHeaders = ({
  contentDisposition,
  contentType,
  fallback
}: {
  contentDisposition: string | null
  contentType: string | null
  fallback: 'fit' | 'gpx' | 'tcx'
}): 'fit' | 'gpx' | 'tcx' => {
  if (contentDisposition) {
    let normalizedDisposition = contentDisposition
    try {
      normalizedDisposition = decodeURIComponent(contentDisposition)
    } catch {
      // Keep original value if decoding fails.
    }
    const match = normalizedDisposition.match(/\.(fit|gpx|tcx)(?:\.gz)?/i)
    if (match?.[1]) {
      return match[1].toLowerCase() as 'fit' | 'gpx' | 'tcx'
    }
  }

  if (contentType) {
    const normalized = contentType.toLowerCase()
    if (normalized.includes('gpx')) {
      return 'gpx'
    }
    if (normalized.includes('tcx')) {
      return 'tcx'
    }
    if (normalized.includes('fit')) {
      return 'fit'
    }
  }

  return fallback
}

const getMimeTypeFromExportFileType = (fileType: 'fit' | 'gpx' | 'tcx') => {
  switch (fileType) {
    case 'gpx':
      return 'application/gpx+xml'
    case 'tcx':
      return 'application/vnd.garmin.tcx+xml'
    case 'fit':
    default:
      return 'application/vnd.ant.fit'
  }
}

const fetchStravaActivityExport = async ({
  activityId,
  endpoint,
  accessToken
}: {
  activityId: string
  endpoint: 'export_original' | 'export_gpx'
  accessToken: string
}) => {
  const response = await fetch(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}/${endpoint}`,
    {
      method: 'GET',
      headers: getStravaAuthHeaders(accessToken)
    }
  )

  if (response.ok) {
    return response
  }

  const detail = await getStravaErrorDetail(response)

  if (response.status === 404) {
    logger.warn({
      message: 'Strava activity export not found',
      activityId,
      endpoint,
      status: response.status
    })
    return null
  }

  throw new Error(
    `Failed to fetch Strava activity export (${response.status}): ${detail}`
  )
}

export const getStravaActivityStartTimeMs = (activity: StravaActivity) => {
  if (!activity.start_date) {
    return undefined
  }

  const timestamp = new Date(activity.start_date).getTime()
  if (!Number.isFinite(timestamp)) {
    return undefined
  }

  return timestamp
}

export const getStravaActivityDurationSeconds = (activity: StravaActivity) => {
  if (
    typeof activity.elapsed_time === 'number' &&
    Number.isFinite(activity.elapsed_time) &&
    activity.elapsed_time > 0
  ) {
    return activity.elapsed_time
  }

  if (
    typeof activity.moving_time === 'number' &&
    Number.isFinite(activity.moving_time) &&
    activity.moving_time > 0
  ) {
    return activity.moving_time
  }

  return 0
}

export const mapStravaVisibilityToMastodon = (
  visibility?: StravaActivityVisibility | null
): MastodonVisibility => {
  switch (visibility) {
    case 'everyone':
      return 'public'
    case 'followers_only':
      return 'private'
    case 'only_me':
      return 'direct'
    default:
      return 'private'
  }
}

export const buildStravaActivitySummary = (activity: StravaActivity) => {
  const { label, emoji } = getActivityLabelAndEmoji(activity)
  const title = activity.name?.trim()
  const durationSeconds = getStravaActivityDurationSeconds(activity)
  const distanceText = formatFitnessDistance(activity.distance)
  const durationText = formatFitnessDuration(durationSeconds)
  const elevationText = formatFitnessElevation(activity.total_elevation_gain)
  const description = activity.description?.trim()

  const metricParts: string[] = []
  if (distanceText && durationText) {
    metricParts.push(`${distanceText} in ${durationText}`)
  } else if (distanceText) {
    metricParts.push(distanceText)
  } else if (durationText) {
    metricParts.push(durationText)
  }

  if (elevationText) {
    metricParts.push(`${elevationText} gain`)
  }

  const firstLine = title ? `${emoji} ${title}` : `${emoji} ${label}`
  const secondLine = metricParts.length > 0 ? metricParts.join(' • ') : label
  const stravaUrl = `https://www.strava.com/activities/${activity.id}`

  return [firstLine, secondLine, description, stravaUrl]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join('\n')
}

export const getStravaActivityPhotos = async ({
  activityId,
  accessToken,
  activity,
  limit = 4
}: {
  activityId: string
  accessToken: string
  activity?: StravaActivity
  limit?: number
}): Promise<StravaActivityPhoto[]> => {
  const photoCandidates: StravaActivityPhoto[] = []

  const primaryUrl = pickBestPhotoUrl(activity?.photos?.primary?.urls)
  if (primaryUrl) {
    photoCandidates.push({
      id: toPhotoId(activity?.photos?.primary?.unique_id),
      url: primaryUrl
    })
  }

  const response = await fetch(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}/photos?size=2048`,
    {
      method: 'GET',
      headers: getStravaAuthHeaders(accessToken)
    }
  )

  if (response.ok) {
    const payload = (await response.json()) as unknown
    if (Array.isArray(payload)) {
      photoCandidates.push(
        ...payload
          .map((item) => item as StravaActivityPhotoApiResponse)
          .map((item) => ({
            id: toPhotoId(item.unique_id),
            url: pickBestPhotoUrl(item.urls) ?? ''
          }))
          .filter((item) => item.url.length > 0)
      )
    }
  } else {
    const detail = await getStravaErrorDetail(response)
    logger.warn({
      message: 'Failed to fetch Strava activity photos',
      activityId,
      status: response.status,
      error: detail
    })
  }

  const uniqueUrls = new Set<string>()
  const uniquePhotos = photoCandidates.filter((item) => {
    if (uniqueUrls.has(item.url)) {
      return false
    }
    uniqueUrls.add(item.url)
    return true
  })

  return uniquePhotos.slice(0, Math.max(limit, 0))
}

export const downloadStravaActivityFile = async ({
  activityId,
  accessToken
}: {
  activityId: string
  accessToken: string
}): Promise<File | null> => {
  const originalExport = await fetchStravaActivityExport({
    activityId,
    endpoint: 'export_original',
    accessToken
  })
  const exportResponse =
    originalExport ??
    (await fetchStravaActivityExport({
      activityId,
      endpoint: 'export_gpx',
      accessToken
    }))

  if (!exportResponse) {
    logger.warn({
      message: 'No exportable file available for Strava activity',
      activityId
    })
    return null
  }

  const exportBuffer = await exportResponse.arrayBuffer()
  if (exportBuffer.byteLength <= 0) {
    logger.warn({
      message: 'Strava activity export is empty',
      activityId
    })
    return null
  }

  const fileType = getExportFileTypeFromHeaders({
    contentDisposition: exportResponse.headers.get('content-disposition'),
    contentType: exportResponse.headers.get('content-type'),
    fallback: originalExport ? 'fit' : 'gpx'
  })
  const mimeType = getMimeTypeFromExportFileType(fileType)

  return new File(
    [new Uint8Array(exportBuffer)],
    `strava-${activityId}.${fileType}`,
    {
      type: mimeType
    }
  )
}

export const getStravaActivity = async ({
  activityId,
  accessToken
}: {
  activityId: string
  accessToken: string
}): Promise<StravaActivity> => {
  const response = await fetch(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}`,
    {
      method: 'GET',
      headers: getStravaAuthHeaders(accessToken)
    }
  )

  if (!response.ok) {
    const detail = await getStravaErrorDetail(response)
    throw new Error(
      `Failed to fetch Strava activity (${response.status}): ${detail}`
    )
  }

  return (await response.json()) as StravaActivity
}

export const getValidStravaAccessToken = async ({
  database,
  fitnessSettings
}: {
  database: Database
  fitnessSettings: FitnessSettings
}) => {
  const accessToken = fitnessSettings.accessToken
  if (!accessToken) {
    return null
  }

  const needsRefresh =
    typeof fitnessSettings.tokenExpiresAt === 'number' &&
    fitnessSettings.tokenExpiresAt <=
      Date.now() + STRAVA_TOKEN_REFRESH_BUFFER_MS

  if (!needsRefresh) {
    return accessToken
  }

  if (
    !fitnessSettings.refreshToken ||
    !fitnessSettings.clientId ||
    !fitnessSettings.clientSecret
  ) {
    logger.warn({
      message: 'Strava token appears expired and cannot be refreshed',
      actorId: fitnessSettings.actorId
    })
    return accessToken
  }

  const response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: fitnessSettings.clientId,
      client_secret: fitnessSettings.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: fitnessSettings.refreshToken
    })
  })

  if (!response.ok) {
    const detail = await getStravaErrorDetail(response)
    logger.warn({
      message: 'Failed to refresh Strava access token',
      actorId: fitnessSettings.actorId,
      status: response.status,
      error: detail
    })
    return accessToken
  }

  const tokenData = (await response.json()) as StravaTokenRefreshResponse

  await database.updateFitnessSettings({
    id: fitnessSettings.id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: tokenData.expires_at * 1000
  })

  return tokenData.access_token
}

export const isSupportedStravaPhotoMimeType = (contentType: string) => {
  return ACCEPTED_IMAGE_TYPES.includes(contentType)
}
