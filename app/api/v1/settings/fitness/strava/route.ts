import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const StravaSettingsRequest = z.object({
  clientId: z.string().regex(/^\d+$/, 'Client ID must be numeric'),
  clientSecret: z.string().min(1, 'Client Secret is required')
})

export const GET = traceApiRoute(
  'getStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const settings = await database.getActorSettings({
      actorId: currentActor.id
    })

    const stravaSettings = settings?.fitness?.strava

    if (!stravaSettings) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { configured: false },
        responseStatusCode: 200
      })
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        configured: true,
        clientId: stravaSettings.clientId
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

      const currentSettings = await database.getActorSettings({
        actorId: currentActor.id
      })

      const updatedSettings = {
        ...currentSettings,
        fitness: {
          ...(currentSettings?.fitness || {}),
          strava: {
            clientId,
            clientSecret
          }
        }
      }

      await database.updateActor({
        actorId: currentActor.id,
        ...updatedSettings
      })

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Strava settings saved successfully'
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
      const currentSettings = await database.getActorSettings({
        actorId: currentActor.id
      })

      if (!currentSettings?.fitness?.strava) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'No Strava settings to remove' },
          responseStatusCode: 404
        })
      }

      const updatedSettings = {
        ...currentSettings,
        fitness: {
          ...(currentSettings.fitness || {}),
          strava: undefined
        }
      }

      await database.updateActor({
        actorId: currentActor.id,
        ...updatedSettings
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
