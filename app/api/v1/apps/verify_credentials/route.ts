import { getConfig } from '@/lib/config'
import {
  OAuthGuard,
  getTokenFromHeader,
  hashToken
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/apps/#verify_credentials
// Confirms the OAuth application the current access token belongs to. The guard
// has already validated the token, so here we only resolve the owning client to
// echo its public-facing details back to the client.
export const GET = traceApiRoute(
  'verifyAppCredentials',
  OAuthGuard([Scope.enum.read], async (req, { database }) => {
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
