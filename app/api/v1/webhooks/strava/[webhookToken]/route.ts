import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = { webhookToken: string }

const StravaWebhookEventSchema = z.object({
  object_type: z.string(),
  object_id: z.union([z.string(), z.number()]),
  aspect_type: z.string(),
  owner_id: z.number().optional(),
  event_time: z.number().optional()
})

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

export const POST = traceApiRoute(
  'stravaWebhookEvent',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { webhookToken } = await context.params

    try {
      const bodyRaw = await req.json()
      const parsedBody = StravaWebhookEventSchema.safeParse(bodyRaw)

      if (!parsedBody.success) {
        logger.warn({
          message: 'Invalid Strava webhook payload',
          webhookToken,
          error: parsedBody.error.issues
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid webhook payload' },
          responseStatusCode: 400
        })
      }

      const body = parsedBody.data

      logger.info({
        message: 'Strava webhook event received',
        eventType: body.object_type,
        aspectType: body.aspect_type
      })

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

      if (body.object_type !== 'activity' || body.aspect_type !== 'create') {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { success: true, ignored: true },
          responseStatusCode: 200
        })
      }

      const stravaActivityId = String(body.object_id)

      await getQueue().publish({
        id: getHashFromString(
          `${fitnessSettings.actorId}:strava-activity:${stravaActivityId}:import`
        ),
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: fitnessSettings.actorId,
          stravaActivityId
        }
      })

      logger.info({
        message: 'Queued Strava activity import from webhook',
        actorId: fitnessSettings.actorId,
        stravaActivityId,
        eventType: body.aspect_type
      })

      return apiResponse({
        req,
        allowedMethods: [],
        data: { success: true },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.error({ message: 'Strava webhook processing error', error })
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Processing failed' },
        responseStatusCode: 500
      })
    }
  }
)
