import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  deleteSubscription,
  getSubscription
} from '@/lib/services/strava/webhookSubscription'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { generateAlphanumeric } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const StravaSettingsRequest = z.object({
  clientId: z.string().regex(/^\d+$/, 'Client ID must be numeric').optional(),
  clientSecret: z.string().min(1, 'Client Secret is required').optional(),
  defaultVisibility: Visibility.default('private')
})

const getStravaSettingsSavedResponse = (req: Request) =>
  apiResponse({
    req,
    allowedMethods: [],
    data: {
      success: true,
      message: 'Strava settings saved successfully',
      authorizeUrl: '/api/v1/settings/fitness/strava/authorize'
    },
    responseStatusCode: 200
  })

const getVisibilitySavedResponse = (req: Request) =>
  apiResponse({
    req,
    allowedMethods: [],
    data: {
      success: true,
      message: 'Strava import visibility saved successfully'
    },
    responseStatusCode: 200
  })

const getValidationErrorResponse = (req: Request, error: string) =>
  apiResponse({
    req,
    allowedMethods: [],
    data: { error },
    responseStatusCode: 400
  })

export const GET = traceApiRoute(
  'getStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const config = getConfig()
    const actorHandle = `@${currentActor.username}@${currentActor.domain}`

    const fitnessSettings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'strava'
    })

    if (!fitnessSettings) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          configured: false,
          actorId: currentActor.id,
          actorHandle,
          defaultVisibility: 'private'
        },
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
        actorId: currentActor.id,
        actorHandle,
        clientId: fitnessSettings.clientId,
        connected: !!fitnessSettings.accessToken,
        webhookUrl,
        defaultVisibility: fitnessSettings.defaultVisibility ?? 'private'
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
      const { clientId, clientSecret, defaultVisibility } =
        StravaSettingsRequest.parse(body)

      const existing = await database.getFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'strava'
      })

      if (existing && clientId === undefined && clientSecret === undefined) {
        await database.updateFitnessSettings({
          id: existing.id,
          defaultVisibility
        })

        return getVisibilitySavedResponse(req)
      }

      if (!clientId || !clientSecret) {
        return getValidationErrorResponse(
          req,
          existing
            ? 'Client ID and Client Secret are required to update Strava credentials'
            : 'Client ID and Client Secret are required'
        )
      }

      if (existing) {
        await database.updateFitnessSettings({
          id: existing.id,
          clientId,
          clientSecret,
          webhookToken: existing.webhookToken ?? generateAlphanumeric(32),
          defaultVisibility
        })
      } else {
        await database.createFitnessSettings({
          actorId: currentActor.id,
          serviceType: 'strava',
          clientId,
          clientSecret,
          webhookToken: generateAlphanumeric(32),
          defaultVisibility
        })
      }

      return getStravaSettingsSavedResponse(req)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage =
          error.issues.length > 0 ? error.issues[0].message : 'Invalid input'
        return getValidationErrorResponse(req, errorMessage)
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

      // Delete webhook subscription if credentials exist
      if (existing.clientId && existing.clientSecret) {
        try {
          const subscription = await getSubscription(
            existing.clientId,
            existing.clientSecret
          )
          if (subscription) {
            await deleteSubscription(
              existing.clientId,
              existing.clientSecret,
              subscription.id
            )
            logger.info({
              message: 'Deleted Strava webhook subscription',
              actorId: currentActor.id,
              subscriptionId: subscription.id
            })
          }
        } catch (error) {
          logger.warn({
            message: 'Failed to delete Strava webhook subscription',
            actorId: currentActor.id,
            error
          })
          // Continue with deletion even if webhook cleanup fails
        }
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
