import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = { webhookId: string }

export const GET = traceApiRoute(
  'stravaWebhookVerification',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { webhookId } = await context.params
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

      const fitnessSettings = await database.getFitnessSettings({
        actorId: webhookId,
        serviceType: 'strava'
      })

      if (!fitnessSettings?.webhookToken) {
        logger.warn({
          message: 'No webhook token configured for actor',
          actorId: webhookId
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
          actorId: webhookId
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
        actorId: webhookId
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
    const { webhookId } = await context.params

    try {
      const body = await req.json()

      logger.info({
        message: 'Strava webhook event received',
        webhookId,
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

      const fitnessSettings = await database.getFitnessSettings({
        actorId: webhookId,
        serviceType: 'strava'
      })

      if (!fitnessSettings?.accessToken) {
        logger.warn({
          message: 'No Strava connection found for actor',
          actorId: webhookId
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid webhook' },
          responseStatusCode: 404
        })
      }

      logger.info({
        message: 'Strava activity event',
        actorId: webhookId,
        event: body
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
