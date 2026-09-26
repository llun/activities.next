import { NextRequest, NextResponse } from 'next/server'

import { getConfig } from '@/lib/config'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
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
  const url = new URL(`${protocol}://${host}/fitness/connections/wahoo`)
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

    const active = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (
      !active ||
      active.id !== settings.id ||
      active.clientId !== settings.clientId ||
      active.clientSecret !== settings.clientSecret
    ) {
      return redirectToSettings('credentials_changed')
    }

    try {
      const token = await exchangeWahooCode({
        code,
        redirectUri: getWahooCallbackUrl(),
        clientId: active.clientId!,
        clientSecret: active.clientSecret!
      })
      const tokenExpiresAt = Date.now() + token.expires_in * 1000
      const user = await getWahooUser(database, {
        ...active,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt
      })
      const providerUserId = String(user.id)
      const existingBinding = active.webhookToken
        ? await database.getWahooSettingsByWebhookToken(
            active.webhookToken,
            providerUserId
          )
        : null
      if (existingBinding && existingBinding.id !== active.id) {
        return redirectToSettings('wahoo_account_already_connected')
      }
      if (active.providerUserId && active.providerUserId !== providerUserId) {
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

      let stored
      try {
        stored = await database.updateFitnessSettings({
          id: active.id,
          expectedCredentialVersion: active.credentialVersion ?? 0,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenExpiresAt,
          providerUserId,
          grantedScopes: scopes,
          connectionError: null
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return redirectToSettings('wahoo_account_already_connected')
        }
        throw error
      }
      if (!stored) return redirectToSettings('credentials_changed')
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
