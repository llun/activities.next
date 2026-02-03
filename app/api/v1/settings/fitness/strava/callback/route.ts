import { randomBytes } from 'crypto'
import { NextRequest } from 'next/server'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
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
    const { searchParams } = new URL(req.url)

    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      logger.error({ message: 'Strava OAuth error', error })
      return Response.redirect(
        `${req.nextUrl.origin}/settings/fitness/strava?error=authorization_failed`
      )
    }

    if (!code) {
      return Response.redirect(
        `${req.nextUrl.origin}/settings/fitness/strava?error=no_code`
      )
    }

    const settings = await database.getActorSettings({
      actorId: currentActor.id
    })

    const stravaSettings = settings?.fitness?.strava
    if (!stravaSettings?.clientId || !stravaSettings?.clientSecret) {
      return Response.redirect(
        `${req.nextUrl.origin}/settings/fitness/strava?error=not_configured`
      )
    }

    try {
      const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: stravaSettings.clientId,
          client_secret: stravaSettings.clientSecret,
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
          `${req.nextUrl.origin}/settings/fitness/strava?error=token_exchange_failed`
        )
      }

      const tokenData: StravaTokenResponse = await tokenResponse.json()

      const webhookId = randomBytes(16).toString('hex')

      const updatedSettings = {
        ...settings,
        fitness: {
          ...(settings?.fitness || {}),
          strava: {
            ...stravaSettings,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_at,
            athleteId: tokenData.athlete.id,
            webhookId
          }
        }
      }

      await database.updateActor({
        actorId: currentActor.id,
        ...updatedSettings
      })

      logger.info({
        message: 'Strava OAuth successful',
        actorId: currentActor.id,
        athleteId: tokenData.athlete.id
      })

      return Response.redirect(
        `${req.nextUrl.origin}/settings/fitness/strava?success=true`
      )
    } catch (error) {
      logger.error({ message: 'Strava callback error', error })
      return Response.redirect(
        `${req.nextUrl.origin}/settings/fitness/strava?error=unexpected_error`
      )
    }
  })
)
