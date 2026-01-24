import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { externalRequest } from '@/lib/utils/request'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'

const StravaSettingsRequest = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  webhookId: z.string(),
  enabled: z.string().optional(),
  actorId: z.string().optional()
})

async function registerStravaWebhook(params: {
  clientId: string
  clientSecret: string
  callbackUrl: string
}): Promise<{ id: string } | null> {
  try {
    // Strava webhook subscription endpoint
    const response = await externalRequest({
      url: 'https://www.strava.com/api/v3/push_subscriptions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        callback_url: params.callbackUrl,
        verify_token: 'STRAVA'
      })
    })

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      logger.error({
        message: 'Failed to register Strava webhook',
        statusCode: response.statusCode,
        body: response.body
      })
      return null
    }

    return JSON.parse(response.body as string)
  } catch (error) {
    logger.error({ err: error, message: 'Error registering Strava webhook' })
    return null
  }
}

async function deleteStravaWebhook(params: {
  subscriptionId: string
  clientId: string
  clientSecret: string
}): Promise<boolean> {
  try {
    const response = await externalRequest({
      url: `https://www.strava.com/api/v3/push_subscriptions/${params.subscriptionId}?client_id=${params.clientId}&client_secret=${params.clientSecret}`,
      method: 'DELETE'
    })

    return response.statusCode === 200 || response.statusCode === 204
  } catch (error) {
    logger.error({ err: error, message: 'Error deleting Strava webhook' })
    return false
  }
}

export const POST = traceApiRoute(
  'updateStravaSettings',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.formData()
    const json = Object.fromEntries(body.entries())

    const parsed = StravaSettingsRequest.parse(json)

    // Extract the actorId from the form data, default to currentActor.id
    const targetActorId = parsed.actorId || currentActor.id

    // Verify the user has access to this actor
    if (currentActor.account) {
      const actors = await database.getActorsForAccount({
        accountId: currentActor.account.id
      })
      const hasAccess = actors.some((actor) => actor.id === targetActorId)
      if (!hasAccess) {
        return apiErrorResponse(403)
      }
    }

    // Get current settings
    const currentSettings = await database.getActorSettings({
      actorId: targetActorId
    })
    const currentStravaIntegration = currentSettings?.stravaIntegration || {}

    // Prepare new Strava integration settings
    const stravaIntegration: typeof currentStravaIntegration = {
      ...currentStravaIntegration,
      webhookId: parsed.webhookId,
      enabled: parsed.enabled === 'on'
    }

    // Only update credentials if provided
    if (parsed.clientId) {
      stravaIntegration.clientId = parsed.clientId
    }
    if (parsed.clientSecret) {
      stravaIntegration.clientSecret = parsed.clientSecret
    }

    // If credentials are being updated and integration is enabled, register webhook
    if (
      stravaIntegration.enabled &&
      stravaIntegration.clientId &&
      stravaIntegration.clientSecret
    ) {
      const host = headerHost(req.headers)
      const protocol = host.includes('localhost') ? 'http' : 'https'
      const callbackUrl = `${protocol}://${host}/api/webhooks/strava/${parsed.webhookId}`

      // If there's an existing subscription, delete it first
      if (currentStravaIntegration.stravaSubscriptionId) {
        await deleteStravaWebhook({
          subscriptionId: currentStravaIntegration.stravaSubscriptionId,
          clientId: stravaIntegration.clientId,
          clientSecret: stravaIntegration.clientSecret
        })
      }

      // Register new webhook
      const subscription = await registerStravaWebhook({
        clientId: stravaIntegration.clientId,
        clientSecret: stravaIntegration.clientSecret,
        callbackUrl
      })

      if (subscription) {
        stravaIntegration.stravaSubscriptionId = subscription.id.toString()
      }
    } else if (
      !stravaIntegration.enabled &&
      currentStravaIntegration.stravaSubscriptionId &&
      stravaIntegration.clientId &&
      stravaIntegration.clientSecret
    ) {
      // If disabling, remove the webhook subscription
      await deleteStravaWebhook({
        subscriptionId: currentStravaIntegration.stravaSubscriptionId,
        clientId: stravaIntegration.clientId,
        clientSecret: stravaIntegration.clientSecret
      })
      stravaIntegration.stravaSubscriptionId = undefined
    }

    // Update actor settings
    await database.updateActor({
      actorId: targetActorId,
      stravaIntegration
    })

    const host = headerHost(req.headers)
    const url = new URL('/settings/fitness', `https://${host}`)
    return Response.redirect(url.toString(), 307)
  })
)
