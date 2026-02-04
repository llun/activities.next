import { NextResponse } from 'next/server'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { generateAlphanumeric } from '@/lib/utils/crypto'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'stravaAuthorize',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const config = getConfig()

    const fitnessSettings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'strava'
    })

    if (!fitnessSettings?.clientId) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Strava credentials not configured' },
        responseStatusCode: 400
      })
    }

    const state = generateAlphanumeric(32)
    const redirectUri = `https://${config.host}/api/v1/settings/fitness/strava/callback`

    await database.updateFitnessSettings({
      id: fitnessSettings.id,
      oauthState: state,
      oauthStateExpiry: Date.now() + 10 * 60 * 1000 // 10 minutes
    })

    const stravaAuthUrl = new URL('https://www.strava.com/oauth/authorize')
    stravaAuthUrl.searchParams.set('client_id', fitnessSettings.clientId)
    stravaAuthUrl.searchParams.set('redirect_uri', redirectUri)
    stravaAuthUrl.searchParams.set('response_type', 'code')
    stravaAuthUrl.searchParams.set('scope', 'activity:read_all')
    stravaAuthUrl.searchParams.set('state', state)

    return NextResponse.redirect(stravaAuthUrl.toString())
  })
)
