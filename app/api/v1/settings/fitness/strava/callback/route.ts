import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { ensureWebhookSubscription } from '@/lib/services/strava/webhookSubscription'
import { logger } from '@/lib/utils/logger'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete: {
    id: number
  }
}

export const GET = traceApiRoute(
  'stravaCallback',
  AuthenticatedGuard(async (req: NextRequest, context) => {
    const { currentActor, database } = context
    const config = getConfig()
    const { searchParams } = new URL(req.url)

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      logger.error({ message: 'Strava OAuth error', error })
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=authorization_failed`
      )
    }

    if (!code) {
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=no_code`
      )
    }

    const fitnessSettings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'strava'
    })

    if (!fitnessSettings?.clientId || !fitnessSettings?.clientSecret) {
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=not_configured`
      )
    }

    // Validate OAuth state for CSRF protection
    if (!state || state !== fitnessSettings.oauthState) {
      logger.error({
        message: 'OAuth state mismatch - potential CSRF attack',
        actorId: currentActor.id
      })
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=invalid_state`
      )
    }

    // Check state expiry
    if (
      !fitnessSettings.oauthStateExpiry ||
      Date.now() > fitnessSettings.oauthStateExpiry
    ) {
      logger.error({
        message: 'OAuth state expired',
        actorId: currentActor.id
      })
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=state_expired`
      )
    }

    try {
      const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: fitnessSettings.clientId,
          client_secret: fitnessSettings.clientSecret,
          code,
          grant_type: 'authorization_code'
        })
      })

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text()
        logger.error({
          message: 'Strava token exchange failed',
          status: tokenResponse.status,
          error: errorData
        })
        return Response.redirect(
          `https://${config.host}/settings/fitness/strava?error=token_exchange_failed`
        )
      }

      const tokenData: StravaTokenResponse = await tokenResponse.json()

      // Ensure webhook subscription exists
      const webhookResult = await ensureWebhookSubscription({
        clientId: fitnessSettings.clientId,
        clientSecret: fitnessSettings.clientSecret,
        callbackUrl: `https://${config.host}/api/v1/webhooks/strava/${fitnessSettings.webhookToken}`,
        verifyToken: fitnessSettings.webhookToken!
      })

      if (!webhookResult.success) {
        logger.error({
          message: 'Failed to create Strava webhook subscription',
          actorId: currentActor.id,
          error: webhookResult.error
        })
        // Clear the settings since webhook subscription failed
        await database.deleteFitnessSettings({
          actorId: currentActor.id,
          serviceType: 'strava'
        })
        return Response.redirect(
          `https://${config.host}/settings/fitness/strava?error=webhook_subscription_failed`
        )
      }

      await database.updateFitnessSettings({
        id: fitnessSettings.id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: tokenData.expires_at * 1000,
        oauthState: undefined,
        oauthStateExpiry: undefined
      })

      logger.info({
        message: 'Strava OAuth successful',
        actorId: currentActor.id
      })

      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?success=true`
      )
    } catch (error) {
      logger.error({ message: 'Strava callback error', error })
      return Response.redirect(
        `https://${config.host}/settings/fitness/strava?error=unexpected_error`
      )
    }
  })
)
