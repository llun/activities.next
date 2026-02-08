import crypto from 'crypto'
import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { formatActivitySummary } from '@/lib/services/strava/activitySummary'
import {
  generateMapImage,
  getMapImageContentType
} from '@/lib/services/strava/mapGenerator'
import {
  StravaTokenResponse,
  getActivity,
  getValidAccessToken
} from '@/lib/services/strava/stravaApi'
import { FitnessActivity } from '@/lib/types/domain/fitnessActivity'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

export const STRAVA_ACTIVITY_JOB_NAME = 'StravaActivityJob'

export const JobData = z.object({
  actorId: z.string(),
  stravaActivityId: z.number(),
  aspectType: z.enum(['create', 'update', 'delete'])
})

export type StravaActivityJobData = z.infer<typeof JobData>

export const stravaActivityJob = createJobHandle(
  STRAVA_ACTIVITY_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('stravaActivityJob', async (span) => {
      const { actorId, stravaActivityId, aspectType } = JobData.parse(
        message.data
      )
      span.setAttribute('actorId', actorId)
      span.setAttribute('stravaActivityId', stravaActivityId)
      span.setAttribute('aspectType', aspectType)

      logger.info({
        message: 'Processing Strava activity job',
        actorId,
        stravaActivityId,
        aspectType
      })

      // Handle delete
      if (aspectType === 'delete') {
        await handleDeleteActivity(database, actorId, stravaActivityId)
        span.end()
        return
      }

      // Get fitness settings (contains Strava tokens)
      const fitnessSettings = await database.getFitnessSettings({
        actorId,
        serviceType: 'strava'
      })

      if (!fitnessSettings) {
        logger.warn({
          message: 'No fitness settings found for actor',
          actorId
        })
        span.end()
        return
      }

      if (
        !fitnessSettings.accessToken ||
        !fitnessSettings.refreshToken ||
        !fitnessSettings.clientId ||
        !fitnessSettings.clientSecret
      ) {
        logger.warn({
          message: 'Missing Strava credentials',
          actorId
        })
        span.end()
        return
      }

      try {
        // Get valid access token (refresh if needed)
        const accessToken = await getValidAccessToken({
          accessToken: fitnessSettings.accessToken,
          refreshToken: fitnessSettings.refreshToken,
          tokenExpiresAt: fitnessSettings.tokenExpiresAt || 0,
          clientId: fitnessSettings.clientId,
          clientSecret: fitnessSettings.clientSecret,
          onTokenRefresh: async (tokens: StravaTokenResponse) => {
            await database.updateFitnessSettings({
              id: fitnessSettings.id,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              tokenExpiresAt: tokens.expires_at * 1000 // Convert to milliseconds
            })
          }
        })

        // Fetch activity from Strava
        const stravaActivity = await getActivity(accessToken, stravaActivityId)
        if (!stravaActivity) {
          logger.warn({
            message: 'Strava activity not found or inaccessible',
            stravaActivityId
          })
          span.end()
          return
        }

        // Check if activity already exists
        const existingActivity = await database.getFitnessActivityByStravaId({
          actorId,
          stravaActivityId
        })

        if (existingActivity && aspectType === 'update') {
          // Update existing activity
          await handleUpdateActivity(
            database,
            existingActivity,
            stravaActivity,
            actorId
          )
        } else if (!existingActivity) {
          // Create new activity and status
          await handleCreateActivity(
            database,
            stravaActivity,
            actorId,
            accessToken
          )
        }
      } catch (error) {
        logger.error({
          message: 'Error processing Strava activity',
          error,
          stravaActivityId,
          actorId
        })
        span.recordException(error as Error)
      }

      span.end()
    })
  }
)

async function handleDeleteActivity(
  database: Database,
  actorId: string,
  stravaActivityId: number
): Promise<void> {
  const activity = await database.getFitnessActivityByStravaId({
    actorId,
    stravaActivityId
  })

  if (activity) {
    // Note: We don't delete the status, just the activity record
    // The status remains as a historical record
    await database.deleteFitnessActivity({ id: activity.id })
    logger.info({
      message: 'Deleted fitness activity',
      activityId: activity.id,
      stravaActivityId
    })
  }
}

async function handleUpdateActivity(
  database: Database,
  existingActivity: FitnessActivity,
  stravaActivity: Awaited<ReturnType<typeof getActivity>>,
  actorId: string
): Promise<void> {
  if (!stravaActivity) return

  await database.updateFitnessActivity(existingActivity.id, {
    name: stravaActivity.name,
    type: stravaActivity.type,
    sportType: stravaActivity.sport_type,
    distance: stravaActivity.distance,
    movingTime: stravaActivity.moving_time,
    elapsedTime: stravaActivity.elapsed_time,
    totalElevationGain: stravaActivity.total_elevation_gain,
    averageSpeed: stravaActivity.average_speed,
    maxSpeed: stravaActivity.max_speed,
    averageHeartrate: stravaActivity.average_heartrate,
    maxHeartrate: stravaActivity.max_heartrate,
    averageCadence: stravaActivity.average_cadence,
    averageWatts: stravaActivity.average_watts,
    kilojoules: stravaActivity.kilojoules,
    calories: stravaActivity.calories,
    summaryPolyline: stravaActivity.map?.summary_polyline,
    rawData: stravaActivity
  })

  logger.info({
    message: 'Updated fitness activity',
    activityId: existingActivity.id,
    stravaActivityId: stravaActivity.id,
    actorId
  })
}

async function handleCreateActivity(
  database: Database,
  stravaActivity: Awaited<ReturnType<typeof getActivity>>,
  actorId: string,
  _accessToken: string
): Promise<void> {
  if (!stravaActivity) return

  const activityId = crypto.randomUUID()

  // Get actor for status creation
  const actor = await database.getActorFromId({ id: actorId })
  if (!actor) {
    logger.error({ message: 'Actor not found', actorId })
    return
  }

  // Create fitness activity record
  const fitnessActivity = await database.createFitnessActivity({
    id: activityId,
    actorId,
    stravaActivityId: stravaActivity.id,
    name: stravaActivity.name,
    type: stravaActivity.type,
    sportType: stravaActivity.sport_type,
    startDate: new Date(stravaActivity.start_date),
    timezone: stravaActivity.timezone,
    distance: stravaActivity.distance,
    movingTime: stravaActivity.moving_time,
    elapsedTime: stravaActivity.elapsed_time,
    totalElevationGain: stravaActivity.total_elevation_gain,
    averageSpeed: stravaActivity.average_speed,
    maxSpeed: stravaActivity.max_speed,
    averageHeartrate: stravaActivity.average_heartrate,
    maxHeartrate: stravaActivity.max_heartrate,
    averageCadence: stravaActivity.average_cadence,
    averageWatts: stravaActivity.average_watts,
    kilojoules: stravaActivity.kilojoules,
    calories: stravaActivity.calories,
    startLatlng: stravaActivity.start_latlng,
    endLatlng: stravaActivity.end_latlng,
    summaryPolyline: stravaActivity.map?.summary_polyline,
    rawData: stravaActivity
  })

  // Generate status text
  const statusText = formatActivitySummary(fitnessActivity)

  // Generate map image if polyline exists
  let mapAttachment: {
    type: 'upload'
    id: string
    url: string
    mediaType: string
    width: number
    height: number
    name: string
  } | null = null

  if (stravaActivity.map?.summary_polyline) {
    try {
      const mapImageBuffer = await generateMapImage(
        stravaActivity.map.summary_polyline
      )

      if (mapImageBuffer) {
        // For now, we'll create a data URL for the map
        // In production, this should be uploaded to media storage
        const base64Image = mapImageBuffer.toString('base64')
        const contentType = getMapImageContentType()
        const mediaId = crypto.randomUUID()

        mapAttachment = {
          type: 'upload',
          id: mediaId,
          url: `data:${contentType};base64,${base64Image}`,
          mediaType: contentType,
          width: 600,
          height: 400,
          name: `${stravaActivity.name} route map`
        }

        logger.info({
          message: 'Generated map image for activity',
          activityId,
          stravaActivityId: stravaActivity.id
        })
      }
    } catch (error) {
      logger.error({
        message: 'Failed to generate map image',
        error,
        stravaActivityId: stravaActivity.id
      })
      // Continue without map - activity status is still valuable
    }
  }

  // Create status
  const status = await createNoteFromUserInput({
    text: statusText,
    currentActor: actor,
    attachments: mapAttachment ? [mapAttachment] : [],
    visibility: 'public',
    database
  })

  if (status) {
    // Update activity with status ID
    await database.updateFitnessActivity(activityId, {
      statusId: status.id
    })

    logger.info({
      message: 'Created status for Strava activity',
      activityId,
      statusId: status.id,
      stravaActivityId: stravaActivity.id
    })
  }
}
