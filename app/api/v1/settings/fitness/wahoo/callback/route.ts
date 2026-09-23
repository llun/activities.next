import { NextRequest, NextResponse } from 'next/server'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  WAHOO_OAUTH_SCOPES,
  exchangeWahooCode,
  getWahooUser
} from '@/lib/services/wahoo/api'
import { getWahooCallbackUrl } from '@/lib/services/wahoo/urls'
import { logger } from '@/lib/utils/logger'
import { timingSafeStringEqual } from '@/lib/utils/timingSafeStringEqual'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const redirectToSettings = (error?: string) => {
  const host = getConfig().host
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const url = new URL(`${protocol}://${host}/fitness/wahoo`)
  url.searchParams.set(error ? 'error' : 'success', error ?? 'true')
  return NextResponse.redirect(url)
}

export const GET = traceApiRoute(
  'wahooCallback',
  AuthenticatedGuard(async (req: NextRequest, { currentActor, database }) => {
    const code = req.nextUrl.searchParams.get('code')
    const state = req.nextUrl.searchParams.get('state')
    if (!code || !state || req.nextUrl.searchParams.has('error')) {
      return redirectToSettings('authorization_failed')
    }

    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (!settings?.clientId || !settings.clientSecret || !settings.oauthState) {
      return redirectToSettings('not_configured')
    }
    if (!timingSafeStringEqual(state, settings.oauthState)) {
      return redirectToSettings('invalid_state')
    }

    const consumed = await database.consumeFitnessOauthState({
      id: settings.id,
      state,
      now: Date.now()
    })
    if (!consumed) return redirectToSettings('expired_state')

    try {
      const token = await exchangeWahooCode({
        code,
        redirectUri: getWahooCallbackUrl(),
        clientId: settings.clientId,
        clientSecret: settings.clientSecret
      })
      const tokenExpiresAt = Date.now() + token.expires_in * 1000
      const user = await getWahooUser(database, {
        ...settings,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt
      })
      const providerUserId = String(user.id)
      const existingBinding = settings.webhookToken
        ? await database.getWahooSettingsByWebhookToken(
            settings.webhookToken,
            providerUserId
          )
        : null
      if (existingBinding && existingBinding.id !== settings.id) {
        return redirectToSettings('wahoo_account_already_connected')
      }
      if (
        settings.providerUserId &&
        settings.providerUserId !== providerUserId
      ) {
        return redirectToSettings('different_wahoo_account')
      }

      const scopes = token.scope ?? WAHOO_OAUTH_SCOPES
      if (
        !['user_read', 'workouts_read', 'offline_data'].every((scope) =>
          scopes.split(/[ ,]+/).includes(scope)
        )
      ) {
        return redirectToSettings('missing_scope')
      }

      await database.updateFitnessSettings({
        id: settings.id,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt,
        providerUserId,
        grantedScopes: scopes,
        connectionError: null
      })
      return redirectToSettings()
    } catch (error) {
      logger.error({
        message: 'Wahoo OAuth callback failed',
        actorId: currentActor.id,
        err: toLoggableError(error)
      })
      await database.updateFitnessSettings({
        id: settings.id,
        connectionError: 'Wahoo authorization failed. Please reconnect.'
      })
      return redirectToSettings('connection_failed')
    }
  })
)
