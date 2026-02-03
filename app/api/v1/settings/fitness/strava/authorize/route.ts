import { randomBytes } from 'crypto'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'stravaAuthorize',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const config = getConfig()

    const settings = await database.getActorSettings({
      actorId: currentActor.id
    })

    const stravaSettings = settings?.fitness?.strava
    if (!stravaSettings?.clientId) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Strava credentials not configured' },
        responseStatusCode: 400
      })
    }

    const state = randomBytes(16).toString('hex')
    const redirectUri = `${config.host}/api/v1/settings/fitness/strava/callback`

    // Store state in actor settings for CSRF validation
    const updatedSettings = {
      ...(settings || {}),
      fitness: {
        ...(settings?.fitness || {}),
        strava: {
          ...stravaSettings,
          oauthState: state,
          oauthStateExpiry: Date.now() + 10 * 60 * 1000 // 10 minutes
        }
      }
    }

    await database.updateActor({
      actorId: currentActor.id,
      ...updatedSettings
    })

    const stravaAuthUrl = new URL('https://www.strava.com/oauth/authorize')
    stravaAuthUrl.searchParams.set('client_id', stravaSettings.clientId)
    stravaAuthUrl.searchParams.set('redirect_uri', redirectUri)
    stravaAuthUrl.searchParams.set('response_type', 'code')
    stravaAuthUrl.searchParams.set('scope', 'activity:read_all')
    stravaAuthUrl.searchParams.set('state', state)

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        authorizeUrl: stravaAuthUrl.toString(),
        state
      },
      responseStatusCode: 200
    })
  })
)
