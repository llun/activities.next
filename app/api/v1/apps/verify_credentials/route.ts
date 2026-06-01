import { getConfig } from '@/lib/config'
import {
  OAuthGuardAnyScope,
  getTokenFromHeader,
  hashToken
} from '@/lib/services/guards/OAuthGuard'
import { UsableScopes } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/apps/#verify_credentials
// Mastodon 4.3+ accepts any valid app/access token here (no specific scope is
// required), so authenticate against the full usable-scope set rather than
// requiring `read`. The guard validates the token, then we resolve the owning
// client to echo its public-facing details back.
export const GET = traceApiRoute(
  'verifyAppCredentials',
  OAuthGuardAnyScope([...UsableScopes], async (req, { database }) => {
    const token = getTokenFromHeader(req.headers.get('Authorization'))
    const client = token
      ? await database.getClientFromAccessToken({
          hashedToken: hashToken(token)
        })
      : null

    const config = getConfig()
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        name: client?.name ?? 'Web',
        website: client?.website ?? null,
        vapid_key: config.push?.vapidPublicKey ?? null
      }
    })
  })
)
