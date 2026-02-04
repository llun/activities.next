import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { generateAlphanumeric } from '@/lib/utils/crypto'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const runtime = 'nodejs'

const StravaSettingsRequest = z.object({
  clientId: z.string().regex(/^\d+$/, 'Client ID must be numeric'),
  clientSecret: z.string().min(1, 'Client Secret is required')
})

export const GET = traceApiRoute(
  'getStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const config = getConfig()

    const fitnessSettings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'strava'
    })

    if (!fitnessSettings) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { configured: false },
        responseStatusCode: 200
      })
    }

    const webhookUrl = fitnessSettings.webhookToken
      ? `https://${config.host}/api/v1/webhooks/strava/${fitnessSettings.webhookToken}`
      : undefined

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        configured: true,
        clientId: fitnessSettings.clientId,
        connected: !!fitnessSettings.accessToken,
        webhookUrl
      },
      responseStatusCode: 200
    })
  })
)

export const POST = traceApiRoute(
  'saveStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    try {
      const body = await req.json()
      const { clientId, clientSecret } = StravaSettingsRequest.parse(body)

      const existing = await database.getFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'strava'
      })

      const webhookToken = generateAlphanumeric(32)

      if (existing) {
        await database.updateFitnessSettings({
          id: existing.id,
          clientId,
          clientSecret,
          webhookToken
        })
      } else {
        await database.createFitnessSettings({
          actorId: currentActor.id,
          serviceType: 'strava',
          clientId,
          clientSecret,
          webhookToken
        })
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Strava settings saved successfully',
          authorizeUrl: '/api/v1/settings/fitness/strava/authorize'
        },
        responseStatusCode: 200
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage =
          error.issues.length > 0 ? error.issues[0].message : 'Invalid input'
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: errorMessage },
          responseStatusCode: 400
        })
      }
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to save Strava settings' },
        responseStatusCode: 500
      })
    }
  })
)

export const DELETE = traceApiRoute(
  'deleteStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    try {
      const existing = await database.getFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'strava'
      })

      if (!existing) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'No Strava settings to remove' },
          responseStatusCode: 404
        })
      }

      await database.deleteFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'strava'
      })

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Strava settings removed successfully'
        },
        responseStatusCode: 200
      })
    } catch (_error) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to remove Strava settings' },
        responseStatusCode: 500
      })
    }
  })
)
