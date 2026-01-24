import { NextRequest } from 'next/server'
import crypto from 'crypto'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { saveFitnessActivityData } from '@/lib/utils/fitnessStorage'
import { externalRequest } from '@/lib/utils/request'

interface StravaWebhookEvent {
  aspect_type: 'create' | 'update' | 'delete'
  event_time: number
  object_id: number
  object_type: 'activity' | 'athlete'
  owner_id: number
  subscription_id: number
  updates?: Record<string, unknown>
}

interface StravaActivity {
  id: number
  name: string
  description: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  type: string
  sport_type: string
  start_date: string
  start_date_local: string
  timezone: string
  achievement_count: number
  kudos_count: number
  comment_count: number
  athlete_count: number
  photo_count: number
  map: {
    id: string
    polyline: string
    summary_polyline: string
  }
  trainer: boolean
  commute: boolean
  manual: boolean
  private: boolean
  visibility: string
  flagged: boolean
  gear_id: string | null
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
  average_speed: number
  max_speed: number
  average_heartrate?: number
  max_heartrate?: number
  average_watts?: number
  max_watts?: number
  calories?: number
  has_heartrate: boolean
  photos?: {
    primary?: {
      id: number
      unique_id: string
      urls: Record<string, string>
    }
    count: number
  }
}

interface StravaPhoto {
  unique_id: string
  urls: {
    '100': string
    '600': string
  }
  created_at: string
  uploaded_at: string
  caption?: string
  location?: [number, number]
}

// Helper function to fetch activity details from Strava API
async function getStravaActivity(
  activityId: number,
  accessToken: string
): Promise<StravaActivity | null> {
  try {
    const response = await externalRequest({
      url: `https://www.strava.com/api/v3/activities/${activityId}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.statusCode !== 200) {
      console.error('Failed to fetch Strava activity:', response.statusCode)
      return null
    }

    return JSON.parse(response.body as string)
  } catch (error) {
    console.error('Error fetching Strava activity:', error)
    return null
  }
}

// Helper function to fetch activity photos from Strava API
async function getStravaActivityPhotos(
  activityId: number,
  accessToken: string
): Promise<StravaPhoto[]> {
  try {
    const response = await externalRequest({
      url: `https://www.strava.com/api/v3/activities/${activityId}/photos?photo_sources=true&size=600`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.statusCode !== 200) {
      console.error('Failed to fetch Strava photos:', response.statusCode)
      return []
    }

    const data = JSON.parse(response.body as string) as StravaPhoto[]
    return data || []
  } catch (error) {
    console.error('Error fetching Strava photos:', error)
    return []
  }
}

// Helper function to generate static map URL from polyline
// Uses Google Static Maps API - can be configured via environment variable
function generateRouteMapUrl(
  polyline: string,
  width: number = 600,
  height: number = 400
): string {
  // Encode polyline for URL
  const encodedPolyline = encodeURIComponent(polyline)
  
  // Use Google Static Maps API with encoded polyline
  // In production, you should use an API key from environment variable
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || ''
  const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap'
  
  const params = new URLSearchParams({
    size: `${width}x${height}`,
    path: `enc:${encodedPolyline}`,
    maptype: 'roadmap',
    ...(apiKey && { key: apiKey })
  })
  
  return `${baseUrl}?${params.toString()}`
}

// Helper function to refresh Strava OAuth tokens
async function refreshStravaToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{
  access_token: string
  refresh_token: string
  expires_at: number
} | null> {
  try {
    const response = await externalRequest({
      url: 'https://www.strava.com/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    })

    if (response.statusCode !== 200) {
      console.error('Failed to refresh Strava token:', response.statusCode)
      return null
    }

    return JSON.parse(response.body as string)
  } catch (error) {
    console.error('Error refreshing Strava token:', error)
    return null
  }
}

// Unit conversion constants
const METERS_TO_KM = 1000
const SECONDS_TO_MINUTES = 60

function formatActivity(activity: StravaActivity): string {
  const distance = (activity.distance / METERS_TO_KM).toFixed(2) // Convert to km
  const duration = Math.floor(activity.moving_time / SECONDS_TO_MINUTES) // Convert to minutes
  const hours = Math.floor(duration / SECONDS_TO_MINUTES)
  const minutes = duration % SECONDS_TO_MINUTES
  const pace = activity.average_speed
    ? (METERS_TO_KM / SECONDS_TO_MINUTES / activity.average_speed).toFixed(2)
    : null // min/km

  let text = `🏃 ${activity.name}\n\n`
  text += `📊 Activity: ${activity.type}\n`
  text += `📏 Distance: ${distance} km\n`
  text += `⏱️ Time: ${hours > 0 ? `${hours}h ` : ''}${minutes}m\n`

  if (pace) {
    text += `⚡ Pace: ${pace} min/km\n`
  }

  if (activity.total_elevation_gain > 0) {
    text += `⛰️ Elevation: ${activity.total_elevation_gain.toFixed(0)}m\n`
  }

  if (activity.average_heartrate) {
    text += `❤️ Avg Heart Rate: ${activity.average_heartrate.toFixed(0)} bpm\n`
  }

  if (activity.average_watts) {
    text += `⚡ Avg Power: ${activity.average_watts.toFixed(0)}W\n`
  }

  if (activity.calories) {
    text += `🔥 Calories: ${activity.calories.toFixed(0)} kcal\n`
  }

  if (activity.description) {
    text += `\n${activity.description}`
  }

  return text
}

// Helper function to create a status from Strava activity
async function createStatusFromActivity(
  actorId: string,
  activity: StravaActivity,
  database: Database,
  accessToken: string
) {
  const actor = await database.getActorFromId({ id: actorId })
  if (!actor) {
    throw new Error('Actor not found')
  }

  // Check if we already created a status for this activity
  const existingActivity = await database.getFitnessActivity({
    provider: 'strava',
    providerId: activity.id.toString(),
    actorId
  })

  if (existingActivity && existingActivity.statusId) {
    console.log('Activity already exists, skipping creation')
    return existingActivity.statusId
  }

  // Format activity as status text
  const text = formatActivity(activity)

  // Create status
  const statusId = `${actorId}/statuses/${crypto.randomUUID()}`
  const postId = statusId.split('/').pop()
  const actorMention = `@${actor.username}`

  await database.createNote({
    id: statusId,
    url: `https://${actor.domain}/${actorMention}/${postId}`,
    actorId: actor.id,
    text,
    summary: null,
    to: [actor.followersUrl],
    cc: [],
    reply: ''
  })

  // Save fitness activity data
  const fitnessActivityId = crypto.randomUUID()
  
  // Save raw activity data to media storage and get mediaId
  const mediaId = await saveFitnessActivityData(
    database,
    actor,
    activity,
    activity.type
  )

  await database.createFitnessActivity({
    id: fitnessActivityId,
    actorId,
    statusId,
    provider: 'strava',
    providerId: activity.id.toString(),
    type: activity.type,
    name: activity.name,
    description: activity.description || undefined,
    startDate: new Date(activity.start_date),
    distance: activity.distance,
    movingTime: activity.moving_time,
    elapsedTime: activity.elapsed_time,
    totalElevationGain: activity.total_elevation_gain,
    averageSpeed: activity.average_speed,
    maxSpeed: activity.max_speed,
    averageHeartrate: activity.average_heartrate,
    maxHeartrate: activity.max_heartrate,
    averageWatts: activity.average_watts,
    maxWatts: activity.max_watts,
    calories: activity.calories,
    startLatlng: activity.start_latlng || undefined,
    endLatlng: activity.end_latlng || undefined,
    mapPolyline: activity.map?.polyline,
    mapSummaryPolyline: activity.map?.summary_polyline,
    photos: activity.photos ? [activity.photos] : undefined,
    mediaId: mediaId || undefined
  })

  // Create attachments for route map and photos
  const attachmentPromises: Promise<unknown>[] = []

  // Add route map as attachment if polyline exists and activity is outdoor
  if (
    activity.map?.summary_polyline &&
    !activity.trainer &&
    activity.start_latlng
  ) {
    const routeMapUrl = generateRouteMapUrl(activity.map.summary_polyline)
    attachmentPromises.push(
      database.createAttachment({
        actorId: actor.id,
        statusId,
        mediaType: 'image/png',
        url: routeMapUrl,
        width: 600,
        height: 400,
        name: 'Route Map'
      })
    )
  }

  // Fetch and add activity photos as attachments
  if (activity.photo_count > 0) {
    const photos = await getStravaActivityPhotos(activity.id, accessToken)
    for (const photo of photos) {
      // Use the 600px version of the photo
      const photoUrl = photo.urls['600']
      if (photoUrl) {
        attachmentPromises.push(
          database.createAttachment({
            actorId: actor.id,
            statusId,
            mediaType: 'image/jpeg',
            url: photoUrl,
            name: photo.caption || undefined
          })
        )
      }
    }
  }

  // Wait for all attachments to be created
  if (attachmentPromises.length > 0) {
    await Promise.all(attachmentPromises)
  }

  return statusId
}

// GET handler for webhook validation (Strava subscription verification)
export const GET = traceApiRoute(
  'stravaWebhookValidation',
  async (req: NextRequest, _context: { params: Promise<{ webhookId: string }> }) => {
    const _params = await _context.params
    const searchParams = req.nextUrl.searchParams
    
    const hubMode = searchParams.get('hub.mode')
    const hubChallenge = searchParams.get('hub.challenge')
    const hubVerifyToken = searchParams.get('hub.verify_token')

    // Strava sends a verification request when setting up the webhook
    if (hubMode === 'subscribe' && hubVerifyToken === 'STRAVA') {
      return Response.json({ 'hub.challenge': hubChallenge })
    }

    return Response.json({ error: 'Invalid verification request' }, { status: 400 })
  }
)

// POST handler for webhook events
export const POST = traceApiRoute(
  'stravaWebhookEvent',
  async (req: NextRequest, _context: { params: Promise<{ webhookId: string }> }) => {
    const _params = await _context.params
    const webhookId = _params.webhookId

    const database = getDatabase()
    if (!database) {
      return Response.json({ error: 'Database not available' }, { status: 500 })
    }

    // Find actor with this webhook ID
    const actor = await database.getActorFromStravaWebhookId({ webhookId })
    
    if (!actor) {
      console.log('No actor found for webhook ID:', webhookId)
      return Response.json({ success: true }) // Return success to avoid Strava retries
    }

    const event: StravaWebhookEvent = await req.json()

    // Only process new activities
    if (
      event.object_type === 'activity' &&
      event.aspect_type === 'create'
    ) {
      const settings = await database.getActorSettings({ actorId: actor.id })
      const stravaIntegration = settings?.stravaIntegration

      if (!stravaIntegration) {
        console.log('No Strava integration found for actor:', actor.id)
        return Response.json({ success: true })
      }

      let accessToken = stravaIntegration.accessToken
      const refreshToken = stravaIntegration.refreshToken
      const tokenExpiresAt = stravaIntegration.tokenExpiresAt
      const clientId = stravaIntegration.clientId
      const clientSecret = stravaIntegration.clientSecret

      // Check if token needs refresh
      if (
        refreshToken &&
        clientId &&
        clientSecret &&
        tokenExpiresAt &&
        Date.now() / 1000 > tokenExpiresAt
      ) {
        const newTokens = await refreshStravaToken(
          refreshToken,
          clientId,
          clientSecret
        )
        if (newTokens) {
          accessToken = newTokens.access_token
          // Update actor settings with new tokens
          await database.updateActor({
            actorId: actor.id,
            stravaIntegration: {
              ...stravaIntegration,
              accessToken: newTokens.access_token,
              refreshToken: newTokens.refresh_token,
              tokenExpiresAt: newTokens.expires_at
            }
          })
        }
      }

      if (accessToken) {
        const activity = await getStravaActivity(event.object_id, accessToken)
        if (activity) {
          await createStatusFromActivity(actor.id, activity, database, accessToken)
        }
      }
    }

    return Response.json({ success: true })
  }
)
