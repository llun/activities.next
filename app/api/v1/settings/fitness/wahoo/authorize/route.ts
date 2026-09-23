import { NextResponse } from 'next/server'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { WAHOO_OAUTH_SCOPES } from '@/lib/services/wahoo/api'
import { getWahooCallbackUrl } from '@/lib/services/wahoo/urls'
import { generateAlphanumeric } from '@/lib/utils/crypto'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'wahooAuthorize',
  AuthenticatedGuard(async (_req, { currentActor, database }) => {
    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (
      !settings?.clientId ||
      !settings.clientSecret ||
      !settings.webhookToken
    ) {
      return apiErrorResponse(400)
    }

    const state = generateAlphanumeric(48)
    await database.updateFitnessSettings({
      id: settings.id,
      oauthState: state,
      oauthStateExpiry: Date.now() + 10 * 60 * 1000
    })
    const url = new URL('https://api.wahooligan.com/oauth/authorize')
    url.searchParams.set('client_id', settings.clientId)
    url.searchParams.set('redirect_uri', getWahooCallbackUrl())
    url.searchParams.set('scope', WAHOO_OAUTH_SCOPES)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    return NextResponse.redirect(url)
  })
)
