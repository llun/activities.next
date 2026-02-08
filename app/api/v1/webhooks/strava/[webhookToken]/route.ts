import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = { webhookToken: string }

export const GET = traceApiRoute(
  'stravaWebhookVerification',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { webhookToken } = await context.params
    const { searchParams } = new URL(req.url)

    const mode = searchParams.get('hub.mode')
    const token = searchParams.get('hub.verify_token')
    const challenge = searchParams.get('hub.challenge')

    if (mode === 'subscribe' && challenge) {
      const database = await getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Database unavailable' },
          responseStatusCode: 500
        })
      }

      const fitnessSettings = await database.getFitnessSettingsByWebhookToken({
        webhookToken,
        serviceType: 'strava'
      })

      if (!fitnessSettings) {
        logger.warn({
          message: 'No fitness settings found for webhook token'
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Webhook not configured' },
          responseStatusCode: 404
        })
      }

      if (token !== fitnessSettings.webhookToken) {
        logger.warn({
          message: 'Strava webhook verification token mismatch',
          actorId: fitnessSettings.actorId
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid verify token' },
          responseStatusCode: 403
        })
      }

      logger.info({
        message: 'Strava webhook verification successful',
        actorId: fitnessSettings.actorId
      })

      return apiResponse({
        req,
        allowedMethods: [],
        data: { 'hub.challenge': challenge },
        responseStatusCode: 200
      })
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Invalid verification request' },
      responseStatusCode: 400
    })
  }
)

interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number
  subscription_id: number
  event_time: number
  updates?: Record<string, unknown>
}

export const POST = traceApiRoute(
  'stravaWebhookEvent',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { webhookToken } = await context.params

    try {
      const body: StravaWebhookEvent = await req.json()

      logger.info({
        message: 'Strava webhook event received',
        eventType: body.object_type,
        aspectType: body.aspect_type,
        objectId: body.object_id
      })

      // Strava requires 200 response within 2 seconds
      // We must respond quickly and process asynchronously
      const database = await getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Database unavailable' },
          responseStatusCode: 500
        })
      }

      const fitnessSettings = await database.getFitnessSettingsByWebhookToken({
        webhookToken,
        serviceType: 'strava'
      })

      if (!fitnessSettings?.accessToken) {
        logger.warn({
          message: 'No Strava connection found for webhook token'
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid webhook' },
          responseStatusCode: 404
        })
      }

      // Only process activity events
      if (body.object_type === 'activity') {
        // Queue job for async processing
        await getQueue().publish({
          id: getHashFromString(
            `strava-activity-${fitnessSettings.actorId}-${body.object_id}-${body.aspect_type}`
          ),
          name: STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: fitnessSettings.actorId,
            stravaActivityId: body.object_id,
            aspectType: body.aspect_type
          }
        })

        logger.info({
          message: 'Queued Strava activity job',
          actorId: fitnessSettings.actorId,
          stravaActivityId: body.object_id,
          aspectType: body.aspect_type
        })
      } else {
        logger.info({
          message: 'Ignoring non-activity Strava event',
          objectType: body.object_type
        })
      }

      // Always respond 200 to acknowledge receipt
      return apiResponse({
        req,
        allowedMethods: [],
        data: { success: true },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.error({ message: 'Strava webhook processing error', error })
      // Still return 200 to prevent Strava from retrying
      // Log the error for debugging
      return apiResponse({
        req,
        allowedMethods: [],
        data: { success: true },
        responseStatusCode: 200
      })
    }
  }
)
