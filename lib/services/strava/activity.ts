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
export const STRAVA_OAUTH_SCOPE = 'activity:read_all'

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
  upload_id?: number | null
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

export interface StravaUpload {
  id: number
  activity_id?: number | null
  external_id?: string | null
  error?: string | null
  status?: string | null
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

export const getStravaActivityDurationSeconds = (
  activity: Pick<StravaActivity, 'elapsed_time' | 'moving_time'>
) => {
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

export const getStravaUpload = async ({
  uploadId,
  accessToken
}: {
  uploadId: number
  accessToken: string
}): Promise<StravaUpload | null> => {
  const response = await fetch(
    `${STRAVA_API_BASE}/uploads/${encodeURIComponent(uploadId)}`,
    {
      method: 'GET',
      headers: getStravaAuthHeaders(accessToken)
    }
  )

  if (response.ok) {
    return (await response.json()) as StravaUpload
  }

  if (response.status === 404) {
    return null
  }

  if (response.status === 401) {
    return null
  }

  const detail = await getStravaErrorDetail(response)
  throw new Error(
    `Failed to fetch Strava upload (${response.status}): ${detail}`
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

interface StravaStream<T> {
  type: string
  data: T[]
}

export interface StravaStreamSet {
  latlng?: StravaStream<[number, number]>
  time?: StravaStream<number>
  altitude?: StravaStream<number>
  distance?: StravaStream<number>
  heartrate?: StravaStream<number>
  watts?: StravaStream<number>
  velocity_smooth?: StravaStream<number>
  cadence?: StravaStream<number>
  temp?: StravaStream<number>
  moving?: StravaStream<boolean>
  grade_smooth?: StravaStream<number>
}

export const getStravaActivityStreams = async ({
  activityId,
  accessToken
}: {
  activityId: string
  accessToken: string
}): Promise<StravaStreamSet | null> => {
  const response = await fetch(
    `${STRAVA_API_BASE}/activities/${encodeURIComponent(activityId)}/streams?keys=time,latlng,altitude,distance,heartrate,watts,velocity_smooth,cadence,temp,moving,grade_smooth&key_by_type=true`,
    {
      method: 'GET',
      headers: getStravaAuthHeaders(accessToken)
    }
  )

  if (response.ok) {
    return (await response.json()) as StravaStreamSet
  }

  if (response.status === 404) {
    return null
  }

  const detail = await getStravaErrorDetail(response)
  throw new Error(
    `Failed to fetch Strava activity streams (${response.status}): ${detail}`
  )
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const buildGpxFromStravaStreams = (
  activity: Pick<StravaActivity, 'id' | 'name' | 'sport_type' | 'start_date'>,
  streams: StravaStreamSet
): string | null => {
  const latlngData = streams.latlng?.data
  if (!latlngData || latlngData.length === 0) {
    return null
  }

  const startMs = activity.start_date
    ? new Date(activity.start_date).getTime()
    : null

  const trkpts = latlngData
    .map(([lat, lon], index) => {
      let children = ''

      const altitude = streams.altitude?.data[index]
      if (typeof altitude === 'number') {
        children += `<ele>${altitude}</ele>`
      }

      const timeOffset = streams.time?.data[index]
      if (typeof timeOffset === 'number' && startMs !== null) {
        const timestamp = new Date(startMs + timeOffset * 1000).toISOString()
        children += `<time>${timestamp}</time>`
      }

      const extParts: string[] = []
      const hr = streams.heartrate?.data[index]
      if (typeof hr === 'number') extParts.push(`<gpxtpx:hr>${hr}</gpxtpx:hr>`)
      const cad = streams.cadence?.data[index]
      if (typeof cad === 'number') extParts.push(`<gpxtpx:cad>${cad}</gpxtpx:cad>`)
      const speed = streams.velocity_smooth?.data[index]
      if (typeof speed === 'number') extParts.push(`<gpxtpx:speed>${speed}</gpxtpx:speed>`)
      const temp = streams.temp?.data[index]
      if (typeof temp === 'number') extParts.push(`<gpxtpx:atemp>${temp}</gpxtpx:atemp>`)
      if (extParts.length > 0) {
        children += `<extensions><gpxtpx:TrackPointExtension>${extParts.join('')}</gpxtpx:TrackPointExtension></extensions>`
      }

      return `<trkpt lat="${lat}" lon="${lon}">${children}</trkpt>`
    })
    .join('')

  const name = escapeXml(activity.name?.trim() ?? '')
  const sportType = escapeXml(activity.sport_type?.trim() ?? '')

  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="activities.next" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>${name}</name><type>${sportType}</type><trkseg>${trkpts}</trkseg></trk></gpx>`
}

export const buildTcxFromStravaStreams = (
  activity: Pick<
    StravaActivity,
    'sport_type' | 'start_date' | 'distance' | 'elapsed_time' | 'moving_time'
  >,
  streams: StravaStreamSet | null
): string | null => {
  const timeData = streams?.time?.data

  const totalDurationSeconds =
    timeData?.at(-1) ?? getStravaActivityDurationSeconds(activity)

  if (totalDurationSeconds <= 0) {
    return null
  }

  const startMs =
    activity.start_date != null ? new Date(activity.start_date).getTime() : null
  const startTimeIso =
    startMs !== null && Number.isFinite(startMs)
      ? new Date(startMs).toISOString()
      : null

  const totalDistanceMeters =
    streams?.distance?.data?.at(-1) ?? activity.distance ?? 0

  const sportType = escapeXml(activity.sport_type?.trim() ?? '')

  let trackContent = ''
  if (
    timeData &&
    timeData.length > 0 &&
    startMs !== null &&
    Number.isFinite(startMs)
  ) {
    const latlngData = streams?.latlng?.data
    const altitudeData = streams?.altitude?.data
    const heartrateData = streams?.heartrate?.data
    const wattsData = streams?.watts?.data
    const velocityData = streams?.velocity_smooth?.data
    const cadenceData = streams?.cadence?.data
    const trackpoints = timeData
      .map((timeOffset, index) => {
        const timestamp = new Date(startMs + timeOffset * 1000).toISOString()
        let tp = `<Time>${timestamp}</Time>`

        const latlng = latlngData?.[index]
        if (latlng) {
          tp += `<Position><LatitudeDegrees>${latlng[0]}</LatitudeDegrees><LongitudeDegrees>${latlng[1]}</LongitudeDegrees></Position>`
        }

        const altitude = altitudeData?.[index]
        if (typeof altitude === 'number') {
          tp += `<AltitudeMeters>${altitude}</AltitudeMeters>`
        }

        const hr = heartrateData?.[index]
        if (typeof hr === 'number') {
          tp += `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>`
        }

        const cad = cadenceData?.[index]
        if (typeof cad === 'number') {
          tp += `<Cadence>${cad}</Cadence>`
        }

        const extParts: string[] = []
        const speed = velocityData?.[index]
        if (typeof speed === 'number') extParts.push(`<ns3:Speed>${speed}</ns3:Speed>`)
        const watts = wattsData?.[index]
        if (typeof watts === 'number') extParts.push(`<ns3:Watts>${watts}</ns3:Watts>`)
        if (extParts.length > 0) {
          tp += `<Extensions><ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">${extParts.join('')}</ns3:TPX></Extensions>`
        }

        return `<Trackpoint>${tp}</Trackpoint>`
      })
      .join('')
    trackContent = `<Track>${trackpoints}</Track>`
  }

  const lapStartAttr = startTimeIso ? ` StartTime="${startTimeIso}"` : ''
  const activityIdElem = startTimeIso ? `<Id>${startTimeIso}</Id>` : ''
  const sportAttr = sportType ? ` Sport="${sportType}"` : ''

  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity${sportAttr}>${activityIdElem}<Lap${lapStartAttr}><TotalTimeSeconds>${totalDurationSeconds}</TotalTimeSeconds><DistanceMeters>${totalDistanceMeters}</DistanceMeters>${trackContent}</Lap></Activity></Activities></TrainingCenterDatabase>`
}
