import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'stravaWebhookVerification',
  async (req: NextRequest, { params }) => {
    const { webhookId } = await params
    const { searchParams } = new URL(req.url)

    const mode = searchParams.get('hub.mode')
    const token = searchParams.get('hub.verify_token')
    const challenge = searchParams.get('hub.challenge')

    if (mode === 'subscribe' && challenge) {
      // Validate verify token if configured
      const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
      if (expectedToken && token !== expectedToken) {
        logger.warn({
          message: 'Strava webhook verification token mismatch',
          webhookId
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid verify token' },
          responseStatusCode: 403
        })
      }

      logger.info({
        message: 'Strava webhook verification request',
        webhookId
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
  async (req: NextRequest, { params }) => {
    const { webhookId } = await params

    try {
      const body = await req.json()

      logger.info({
        message: 'Strava webhook event received',
        webhookId,
        eventType: body.object_type,
        aspectType: body.aspect_type
      })

      const database = await getDatabase()

      // TODO: This is inefficient for large user bases. Consider:
      // 1. Adding a database index on settings->fitness->strava->webhookId
      // 2. Creating a separate webhook_mappings table
      // 3. Using a key-value store for webhook ID -> actor ID lookups
      const sqlActors = await database.knex('actors').select('*')

      let actorWithWebhook = null
      for (const sqlActor of sqlActors) {
        const settings = await database.getActorSettings({
          actorId: sqlActor.id
        })
        if (settings?.fitness?.strava?.webhookId === webhookId) {
          actorWithWebhook = sqlActor
          break
        }
      }

      if (!actorWithWebhook) {
        logger.warn({
          message: 'No actor found for webhook ID',
          webhookId
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
        actorId: actorWithWebhook.id,
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
